/**
 Copyright 2015 yasin inat

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.

 */
"use strict";

var child   = require('child_process'),
    cheerio = require('cheerio'),
    Emitter = require("events").EventEmitter,
    log     = require('logging').from('arachnod'),
    Redis   = require('redis'),
    _       = require('lodash'),
    url     = require('url'),
    qs      = require('querystring');

(function () {

    var defKey  = process.cwd().split('/').slice(-1) || 'arachnod',
        status  = 'init',
        startTime =  process.hrtime(),
        spiderlings = [],
        tasks = defKey + '_tasks',
        finished = defKey + '_finished',
        urlCache = [],
        redis = null,
        ended = false,
        stats =  {
            'linkCount': 0,
            'downloaded': 0,
            'canceled': 0,
            'ignored': 0,
            'finished': 0,
            'retry': 0,
            'failed': 0
        },
        params = {
            'redis': '127.0.0.1',
            'redisPort': 6379,
            'parallel': 8,
            'verbose': 0,
            'resume': false,
            'sameDomain': true,
            'useCookies': true,
            'obeyRobotsTxt': false,
            'ignorePaths': [],
            'ignoreParams': []
        };


/**
 * Main Module
 * Exposed as an event emitter, provides handling of bot actions.
 *
 * @namespace Arachnod
 * @extends EventEmitter
 * @type {*|EventEmitter}
 * @property {array} spiderlings parallel childs collector
 * @property {object} stats Stats inforrmation
 */
var Arachnod = new Emitter();

// Helper functions

    /**
     * Link checker  [Internal]
     * @param tag
     * @param taskp
     */
    function checkUrl(tag, taskp) {

        if (!!tag.get(0).href){
            var href = tag.get(0).href,
                urlp = url.parse(href),
                queue = true;

            // already added. i guess.
            if (_.indexOf(urlCache, href) !== -1){ return null; }

            // relative links
            //if (!/^(?:[a-z]+:)?\/\//i.test(href)){
            //    urlp.protocol = taskp.protocol;
            //    urlp.host = taskp.host;
            //    urlp.hostname = taskp.hostname;
            //    href = urlp.protocol+'//'+urlp.host + lastPart(taskp.pathname, href);
            //}

            // Not the same domain
            if (urlp.host !== taskp.host){ queue = false; }

            // ignore path. recursively.
            if (!_.isNull(urlp.path) && params.ignorePaths.length > 0){
                _.each(params.ignorePaths, function (ignp) {
                    if (String(urlp.path.substr(0, ignp.length)) === String(ignp)){
                        queue = false;
                    }
                });
            }

            urlp.qsp = qs.parse(urlp.query);

            // ignored qs parameter.
            if (!_.isNull(urlp.query) && params.ignoreParams.length > 0){
                _.each(params.ignoreParams, function (ipg) {
                    urlp.qsp = _.omit(urlp.qsp, ipg);
                });
                var tqs = qs.stringify(urlp.qsp) || [];
                // rebuild href without ignoredParams.
                if (urlp.query !== tqs){
                    href = urlp.protocol+'//'+urlp.host+urlp.pathname+(tqs.length>0?'?'+tqs:'');
                }
            }

            if (queue && !_.isNull(urlp.path)){
                Arachnod.queue({"url": href});
                urlCache.push(href);
                urlCache = _.uniq(urlCache);
                if (params.verbose > 8){ log('queue url', urlCache.length, href, urlp.path); }
            } else {
                stats.ignored++;
            }
        }
    }

    /**
     * Message handler, handles msgs fired by spiderlings.  [Internal]
     * @param msg
     */
    function getMsgs(msg) {
        // log('spiderlings', spiderlings);
        // spiderling makes a hit
        if (!!msg.cmd && msg.cmd === 'hit'){
            processHit(msg.task, msg.result);
            getCounts();
        }

        if (!!msg.cmd && msg.cmd === 'error'){
            Arachnod.emit('error', msg);
        }
        // spiderling is idle more than retry time
        if (!!msg.cmd && msg.cmd === 'exit'){
            _.each(spiderlings, function (sp, k) {
                if (sp && msg.pid === sp.pid){
                    spiderlings[k].kill('SIGKILL');
                    _.remove(spiderlings, function(s) { return s.pid === msg.pid; });
                }
                checkSpi();
            });
        }

        // spiderling is ready
        if (!!msg.cmd && msg.cmd === 'ready'){
            _.each(spiderlings, function (spi) {
                if (spi.pid === msg.pid){
                    spi.send({'cmd':'run'});
                }
            });
        }
    }


    /**
     * Spiderlings checker. if none left, emits end event.
     */
    function checkSpi() {
        setTimeout(function () {
            if (spiderlings.length === 0 && ended === false){
                Arachnod.emit('end', stats, urlCache);
                ended = true;
                console.timeEnd('botTime');
            }
        }, 200);
    }


    /**
     * Redis stats
     */
    function getCounts() {
        redis.multi()
            .scard(tasks)
            .scard(finished)
            .dbsize()
            .exec(function (err, reply) {
                stats.tasks = reply[0];
                stats.finished = reply[1];
                stats.dbsize = reply[2];
                stats.urlCount = urlCache.length;
            });
    }


    /**
     * Crawler start func, forks childs. [Internal]
     */
    function initiate() {
        console.time('botTime');
        log('Started to crawl: ' + params.start + ' at ' + startTime);
        Arachnod.queue({'url': params.start});
        for(var i = 0; i<params.parallel; i++) {
            spiderlings[i] = child.fork(__dirname + '/spiderling.js', [params.redis, tasks, finished, params.verbose]);
            spiderlings[i].on('message', getMsgs);
        }
    }


    /**
     * Hit processor
     * @param task
     * @param result
     */
    function processHit(task, result) {

        if (!!result && !!task && !!task.url && result.status === 200){
            status = "parsing " + task.url; stats.downloaded++;
            try {
                // only text/html will be downloaded!
                if (result.headers['content-type'].slice(0,9) !== 'text/html'){ throw 'cancelUrl'; }
                var $ = cheerio.load(result.text),
                    taskp = url.parse(task.url),
                    doc = { "url": task.url, "headers": result.headers };

                taskp.qsp = qs.parse(taskp.query);
                _.assign(doc, taskp);
                // loop links
                // @TODO: parse JS links with window.location


                _.each($('a').get(), function (tag) {
                    log(tag.attribs);
                    // checkUrl(_.omit(tag, ['parent', 'prev', 'next']),  taskp);
                });
                stats.finished++;
                Arachnod.emit('hit', doc, $);

            } catch(e) {
                if (e === 'retry'){
                    Arachnod.queue(task);
                    stats.retry++;
                } else if (e === 'cancelUrl') {
                    if (params.verbose > 5){ log('canceled', task); }
                    stats.canceled++;
                } else if (e === 'ignoreUrl') {
                    if (params.verbose > 5){ log('ignored', task); }
                    stats.ignored++;
                } else {
                    stats.failed++;
                    Arachnod.emit('error', [task, e, (!_.isUndefined(e.stack)?e.stack:'none')]);
                }
                //Arachnod.taskRetry(task, result.res.statusCode);
            } finally {
                Arachnod.emit('stats', Arachnod.getStats());
            }
        } else {
            if (!!task){ Arachnod.queue(task); }
        }
    }



    /**
     * Resets Redis queues, can be called by user
     * @param cb
     */
    function resetQueues(cb) {
        redis.del(tasks, function (err, rt) {
            if (err) { throw err; }
            redis.del(finished, function (err, rf) {
                if (err) { throw err; }
                log('Task Queue has been reset!');
                cb(rt, rf);
            });
        });
        return Arachnod;
    }



    /**
     * Stats reporter fn.
     * @returns {{tasks: number, downloaded: number, canceled: number, ignored: number, finished: number, retry: number, failed: number}}
     */
    Arachnod.getStats = function () {
        stats.mem = Math.ceil((process.memoryUsage().rss/1024)/1024) + 'MB';
        stats.children = spiderlings.length;
        return stats;
    };


    /**
     * Adds a new url to task queue.
     * use a plain object with "url" key.
     * @param taskData
     */
    Arachnod.queue = function (taskData) {
        if (!!taskData.url){
            var taskStr = JSON.stringify(taskData);
            redis.sismember(finished, taskStr, function (err, res) {
                if (!res){
                    redis.sadd(tasks, taskStr);
                    stats.linkCount++;
                }
            });
        }
        return Arachnod;
    };


    /**
     * pauses bot via killing all spiderlings with resetting queue.
     */
    Arachnod.pause = function () {
        _.each(spiderlings, function (spi) { spi.kill(); });
        log('Bot paused!');
        return Arachnod;
    };

    /**
     * Restarts bot
     * @returns {*}
     */
    Arachnod.continue = function () {
        initiate();
        log('Bot restarted!');
        return Arachnod;
    };



    /**
     * Resets all queues & bot
     * @returns {*}
     */
    Arachnod.reset = function () {
        _.each(spiderlings, function (spi) { spi.kill(); });
        resetQueues(initiate);
        log('Bot reset, purged all queues & restarted!');
        return Arachnod;
    };

    /**
     * Crawler
     * @param userParams
     */
    Arachnod.crawl = function (userParams) {

        params = _.defaults(userParams, params);

        redis = Redis.createClient(params.redisPort, params.redis);

        if (!params.resume){
            resetQueues(initiate);
        } else {
            initiate();
        }
        return Arachnod;
    };

    module.exports = Arachnod;

}());

process.on('uncaughtException', function (err) {
    log('uncaughtException:', err, err.stack);
});