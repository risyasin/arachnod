"use strict";

var redis   = require("redis"),
    child   = require('child_process'),
    Event   = require("eventemitter2").EventEmitter2,
    Url     = require("url"),
    cheerio = require("cheerio"),
    _       = require("underscore"),
    defKey  = process.cwd().split("/").slice(-1) || 'arachnod',
    Arch = new Event({
        delimiter: '::',
        newListener: false,
        maxListeners: 20
    }),
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
    };


Arch.processHit = function (task, result) {
    if (!!result && !!task && !!task.url && result.status === 200){
        status = "parsing " + task.url; stats.downloaded++;
        try {
            // only text/html will be downloaded!
            if (result.headers['content-type'].slice(0,9) !== 'text/html'){ throw 'cancelUrl'; }
            var $ = cheerio.load(result.text),
                taskp = Url.parse(task.url),
                doc = {
                    "url": task.url,
                    "parsed": taskp,
                    "headers": result.headers
                };
            // loop links
            // @TODO: parse JS links with window.location
            _.each($("a"), function (item) {
                if (!!item.attribs.href){
                    var href = item.attribs.href, urlp = Url.parse(href);
                    if (urlp.host === taskp.host){ // same domain
                        if (_.indexOf(params.ignorePaths, urlp.path) === -1) {
                            Arch.queue({"url": href});
                            stats.added++;
                            if (params.verbose > 8){ console.log(['queue url', href, urlp.path]); }
                        }
                    }
                }
            });
            stats.finished++;
            Arch.emit('hit', doc, $);

        } catch(e) {
            if (e === 'retry'){
                Arch.queue(task);
                stats.retry++;
            } else if (e === 'cancelUrl') {
                if (params.verbose > 5){ console.log(['canceled', task]); }
                stats.canceled++;
            } else if (e === 'ignoreUrl') {
                if (params.verbose > 5){ console.log(['ignored', task]); }
                stats.ignored++;
            } else {
                stats.failed++;
                console.log(['processHit failed', task]);
                Arch.emit('error', task, e);
            }
            //Arch.taskRetry(task, result.res.statusCode);
        } finally {
            Arch.statsLog();
        }
    } else {
        if (!!task){ Arch.queue(task); }
    }
};

Arch.statsLog = function () {
    stats.mem = Math.ceil((process.memoryUsage().rss/1024)/1024) + ' Mb';
    stats.children = spiderlings.length;
    Arch.emit('stats', stats);
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
            console.log('Previous task canceled! ' + rt + ' - ' + rf);
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
        //console.log('Tasks: '+ Arch.rc.scard(tasks) + ' Finished: ' + Arch.rc.scard(finished));
        //console.log(msg);
    },
    initiate = function () {
        console.log('Started to crawl: ' + params.start + ' at ' + startTime);
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

process.on("uncaughtException", function (err) {
    console.log(err.stack);
});

module.exports = Arch;

