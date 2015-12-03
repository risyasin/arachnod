"use strict";

(function () {
    
    var redis   = require('redis'),
        child   = require('child_process'),
        cheerio = require('cheerio'),
        ee2     = require('eventemitter2').EventEmitter2,
        log     = require('./logging').from('arachnod'),
        _       = require('lodash'),
        url     = require('url'),
        qs      = require('querystring'),
        defKey  = process.cwd().split('/').slice(-1) || 'arachnod',
        status  = 'init',
        startTime =  process.hrtime(),
        spiderlings = [],
        tasks = defKey + '_tasks',
        finished = defKey + '_finished',
        params = {
            'redis': '127.0.0.1',
            'redisPort': 6379,
            'parallel': 8,
            'verbose': 0,
            'resume': false,
            'sameDomain': true,
            'useCookies': true,
            'obeyRobotsTxt': false
        };


/**
 * Arachnod Base process to control bots/spiderlings
 * is an EventEmitter emits hit, error, end & stats events.
 * @type {*}
 */
var Arachnod = new ee2({
    wildcard: false,
    newListener: false,
    maxListeners: 20
});

// Url cache can be exposed.
Arachnod.urlCache = [];
Arachnod.ended = false;


Arachnod.stats =  {
    'linkCount': 0,
    'downloaded': 0,
    'canceled': 0,
    'ignored': 0,
    'finished': 0,
    'retry': 0,
    'failed': 0
};

// Helper functions

    /**
     * Link checker  [Internal]
     * @param tag
     * @param taskp
     */
    function checkUrl(tag, taskp) {
        if (!!tag.attribs.href){
            var href = tag.attribs.href,
                urlp = url.parse(href),
                queue = true;

            // already added. i guess.
            if (_.indexOf(Arachnod.urlCache, href) !== -1){ return null; }

            // relative links
            if (_.isNull(urlp.protocol) && _.isNull(urlp.host)){
                urlp.protocol = taskp.protocol;
                urlp.host = taskp.host;
                urlp.hostname = taskp.hostname;
                href = urlp.protocol+'//'+urlp.host+urlp.pathname;
            }

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
                var tqs = qs.stringify(urlp.qsp);
                // rebuild href without ignoredParams.
                if (urlp.query !== tqs){
                    href = urlp.protocol+'//'+urlp.host+urlp.pathname+(tqs.length>0?'?'+tqs:'');
                }
            }

            if (queue){
                Arachnod.queue({"url": href});
                Arachnod.urlCache.push(href);
                Arachnod.urlCache = _.uniq(Arachnod.urlCache);
                if (params.verbose > 8){ log('queue url', href, urlp.path); }
            } else {
                Arachnod.stats.ignored++;
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
            if (spiderlings.length === 0 && Arachnod.ended === false){
                Arachnod.emit('end', Arachnod.stats, Arachnod.urlCache);
                Arachnod.ended = true;
                console.timeEnd('botTime');
            }
        }, 200);
    }


    /**
     * Redis stats
     */
    function getCounts() {
        Arachnod.rc.multi()
            .scard(tasks)
            .scard(finished)
            .dbsize()
            .exec(function (err, reply) {
                Arachnod.stats.tasks = reply[0];
                Arachnod.stats.finished = reply[1];
                Arachnod.stats.dbsize = reply[2];
                Arachnod.stats.urlCount = Arachnod.urlCache.length;
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
            status = "parsing " + task.url; Arachnod.stats.downloaded++;
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
                _.each($('a'), function (tag) { checkUrl(tag,  taskp); });
                Arachnod.stats.finished++;
                Arachnod.emit('hit', doc, $);

            } catch(e) {
                if (e === 'retry'){
                    Arachnod.queue(task);
                    Arachnod.stats.retry++;
                } else if (e === 'cancelUrl') {
                    if (params.verbose > 5){ log('canceled', task); }
                    Arachnod.stats.canceled++;
                } else if (e === 'ignoreUrl') {
                    if (params.verbose > 5){ log('ignored', task); }
                    Arachnod.stats.ignored++;
                } else {
                    Arachnod.stats.failed++;
                    log('processHit failed', task);
                    Arachnod.emit('error', task, e);
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
        Arachnod.rc.del(tasks, function (err, rt) {
            if (err) { throw err; }
            Arachnod.rc.del(finished, function (err, rf) {
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
        Arachnod.stats.mem = Math.ceil((process.memoryUsage().rss/1024)/1024) + 'MB';
        Arachnod.stats.children = spiderlings.length;
        return Arachnod.stats;
    };


    /**
     * Adds a new url to task queue.
     * use a plain object with "url" key.
     * @param taskData
     */
    Arachnod.queue = function (taskData) {
        if (!!taskData.url){
            var taskStr = JSON.stringify(taskData);
            Arachnod.rc.sismember(finished, taskStr, function (err, res) {
                if (!res){
                    Arachnod.rc.sadd(tasks, taskStr);
                    Arachnod.stats.linkCount++;
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

        Arachnod.rc = redis.createClient(params.redisPort, params.redis);

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
    console.log(err);
});