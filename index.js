"use strict";

var redis   = require('redis'),
    child   = require('child_process'),
    cheerio = require('cheerio'),
    ee2     = require('eventemitter2').EventEmitter2,
    log     = require('logging').from(__filename),
    _       = require('lodash'),
    url     = require('url'),
    qs      = require('querystring'),
    defKey  = process.cwd().split('/').slice(-1) || 'arachnod',
    status  = 'init',
    startTime =  Date.now(),
    stats =  { 'added': 0, 'downloaded': 0, 'canceled': 0, 'ignored': 0, 'finished': 0, 'retry': 0, 'failed': 0 },
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
        'useCookies': true
    },
    Arch = new ee2({
        wildcard: false,
        newListener: false,
        maxListeners: 20
    });



Arch.checkAnchor = function (anchor, taskp) {

    if (!!anchor.attribs.href){
        var href = anchor.attribs.href,
            urlp = url.parse(href),
            queue = true;


        // Not the same domain
        if (urlp.host !== taskp.host){ queue = false; }

        // ignore path. recursively.
        if (!_.isNull(urlp.path) && params.ignorePaths.length > 0){
            _.each(params.ignorePaths, function (ignp) {
                if (String(urlp.path.substr(0, ignp.length)) === String(ignp)){ queue = false; }
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
            Arch.queue({"url": href});
            stats.added++;
            if (params.verbose > 8){ log(['queue url', href, urlp.path]); }
        }
    }

};

Arch.processHit = function (task, result) {
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
            _.each($('a'), function (anchor) { Arch.checkAnchor(anchor,  taskp); });
            stats.finished++;
            Arch.emit('hit', doc, $);

        } catch(e) {
            if (e === 'retry'){
                Arch.queue(task);
                stats.retry++;
            } else if (e === 'cancelUrl') {
                if (params.verbose > 5){ log(['canceled', task]); }
                stats.canceled++;
            } else if (e === 'ignoreUrl') {
                if (params.verbose > 5){ log(['ignored', task]); }
                stats.ignored++;
            } else {
                stats.failed++;
                log(['processHit failed', task]);
                Arch.emit('error', task, e);
            }
            //Arch.taskRetry(task, result.res.statusCode);
        } finally {
            Arch.emit('stats', Arch.stats());
        }
    } else {
        if (!!task){ Arch.queue(task); }
    }
};

Arch.stats = function () {
    stats.mem = Math.ceil((process.memoryUsage().rss/1024)/1024) + ' M';
    stats.children = spiderlings.length;
    return stats;
};

Arch.queue = function (taskData) {
    if (!!taskData.url){
        var taskStr = JSON.stringify(taskData);
        Arch.rc.sismember(finished, taskStr, function (err, res) {
            if (!res){
                Arch.rc.sadd(tasks, taskStr);
            }
        });
    }
};

Arch.resetQueues = function (cb) {
    Arch.rc.del(tasks, function (err, rt) {
        if (err) { throw err; }
        Arch.rc.del(finished, function (err, rf) {
            if (err) { throw err; }
            log('Previous task canceled! ' + rt + ' - ' + rf);
            cb();
        });
    });
};

Arch.crawl = function (userParams) {

    params = _.defaults(userParams, params);

    Arch.rc = redis.createClient(params.redisPort, params.redis);

    var getMsgs = function (msg) {
        if (!!msg.cmd && msg.cmd === 'hit'){
            Arch.processHit(msg.task, msg.result);
        }
        if (!!msg.cmd && msg.cmd === 'exit'){
            _.each(spiderlings, function (sp, k) {
                if (sp && msg.pid === sp.pid){
                    delete spiderlings[k];
                }
            });

            if (spiderlings.length === 0){
                Arch.emit('end', stats);
            }
        }
        //log('Tasks: '+ Arch.rc.scard(tasks) + ' Finished: ' + Arch.rc.scard(finished));
        //log(msg);
    },
    initiate = function () {
        log('Started to crawl: ' + params.start + ' at ' + startTime);
        Arch.queue({'url': params.start});
        for(var i = 0; i<params.parallel; i++) {
            spiderlings[i] = child.fork(__dirname + '/spiderling.js', [params.redis, tasks, finished, params.verbose]);
            spiderlings[i].on('message', getMsgs);
            spiderlings[i].send({'cmd':'run'});
        }
    };

    if (!params.resume){
        Arch.resetQueues(initiate);
    } else {
        initiate();
    }

};

process.on('uncaughtException', function (err) {
    log(err.stack);
});

module.exports = Arch;

