"use strict";

var redis   = require("redis"),
    Event   = require("eventemitter2").EventEmitter2,
    Agent   = require("superagent"),
    Url     = require("url"),
    cheerio = require("cheerio"),
    _       = require("underscore"),
    defKey  = process.cwd().split("/").slice(-1) || 'arachnod';

module.exports = function (rs) {

    var Arch = new Event({
            delimiter: '::',
            newListener: false,
            maxListeners: 20
        }),
        rc = redis.createClient(6379, rs),
        status = {
            "set": "init",
            "startTime": Date.now(),
            "stop": false
        },
        cache = [],
        tasks = defKey + '_tasks',
        finished = defKey + '_finished',
        cfg = {
            "resume": false,
            "sameDomain": true,
            "useCookies": true,
            "userAgents": {
                "googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                "yandex": "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
                "bing": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
                "arachnod": "Mozilla/5.0 (compatible; Arachnod/0.1; Bot/0.1; +http://arachnod.evrima.net/)",
                "firefox": "Mozilla/5.0 (Windows NT 5.1; rv:31.0) Gecko/20100101 Firefox/31.0",
                "chrome": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/36.0.1985.67 Safari/537.36",
                "ie": "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; WOW64; Trident/6.0)",
                "ie10": "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; WOW64; Trident/6.0)",
                "ie9": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 7.1; Trident/5.0)",
                "ie8": "Mozilla/5.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/4.0; GTB7.4; InfoPath.2; SV1; .NET CLR 3.3.69573; WOW64; en-US)",
                "ie7": "Mozilla/5.0 (Windows; U; MSIE 7.0; Windows NT 6.0; en-US)",
                "ie6": "Mozilla/4.0 (compatible; MSIE 6.01; Windows NT 6.0)",
                "opera": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/28.0.1500.52 Safari/537.36 OPR/15.0.1147.100",
                "safari": "Mozilla/5.0 (iPad; CPU OS 6_0 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/6.0 Mobile/10A5355d Safari/8536.25"
            }
        };

    Arch.headers = (function () {
        // @Todo: Auto generation of Accept headers by task
        // @Todo: Auto generation of Accept=Language headers by configuration
        return {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Encoding": "gzip,deflate,sdch",
            "Accept-Language": "en-US,en;q=0.8,tr;q=0.6",
            "User-Agent": cfg.userAgents.arachnod,
            "Referer": "http://www.google.com/",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": 0
        };
    }());

    Arch.queue = function (taskData) {
        if (taskData.url){
            if (_.indexOf(cache, taskData.url) === -1){
                var taskStr = JSON.stringify(taskData);
                rc.sismember(finished, taskStr, function (err, res) {
                    if (!res){
                        rc.sadd(tasks, taskStr);
                        cache.push(taskData.url);
                    }
                });
            }
        }
    };


    Arch.finish = function (taskData) {
        if (taskData.url){
            rc.sadd(finished, JSON.stringify(taskData));
            Arch.checkTasks();
        }
    };


    Arch.checkTasks = function () {
        rc.scard(tasks, function (err, tl) {
            rc.scard(finished, function (err, fl) {
                if (fl === tl){ process.send({ cmd: 'end' }); }
            });
        });
    };

    Arch.getTask = function (cb) {
        rc.spop(tasks, function (err, task) {
            if (task !== null){
                task = JSON.parse(task);
                cb(task);
            } else {
                // retry
                setTimeout(Arch.run, 500);
            }
        });
    };

    Arch.setStatus = function (msg) {
        status.set = msg;
    };

    Arch.runTask = function (task, cb) {
        // var url = Url.parse(task.url);
        status.set = "downloading";
        Agent.get(task.url)
            .set(Arch.headers)
            .end(function(result){
                cb(true, task, result);
                result = null;
            });
    };

    Arch.taskRetry = function (task, code) {
        task.lastResponse = code;
        if (task.retry){ task.retry++; } else { task.retry = 1; }
        Arch.setStatus("retrying");
        setTimeout(function () {
            Arch.runTask(task, Arch.processResponse);
        }, 10000);
    };

    Arch.processResponse = function (success, task, result) {
        if (task.url && result.res.statusCode === 200){
            //console.log([success, result.res.statusCode, result.res.headers, result.res.text]);
            Arch.setStatus("parsing " + task.url);
            try {
                var $ = cheerio.load(result.res.text),
                    taskp = Url.parse(task.url),
                    doc = {
                        "url": task.url,
                        "parsed": taskp,
                        "headers": result.res.headers
                    };
                _.each($("a"), function (item, i) {
                    var href = item.attribs.href, urlp = Url.parse(href);
                    if (urlp.host === taskp.host){ // same domain
                        Arch.queue({"url": href});
                    }
                });
                Arch.emit('hit', doc, $, result.res.text);
                Arch.finish(task);
                doc = null;
            } catch(e) {
                console.log(['processResponse failed', e, task]);
                //Arch.taskRetry(task, result.res.statusCode);
            } finally {
                Arch.setStatus("idle");
                Arch.run();
            }
        } else {
            Arch.taskRetry(task, result.res.statusCode);
        }
        result = null;
    };

    Arch.run = function () {
        Arch.setStatus("running");
        Arch.getTask(function (task) {
            if (typeof task !== 'undefined' && task.url){
                Arch.runTask(task, Arch.processResponse);
            } else {
                // while idle.
                Arch.setStatus("idle");
                setTimeout(Arch.run, 500);
            }
        });
    };

    
    Arch.reset = function () {
        rc.del(tasks, function (err, rt) {
            if (err) { throw err; }
            rc.del(finished, function (err, rf) {
                if (err) { throw err; }
                console.log('Previous task canceled! ' + rt + ' - ' + rf);
            });
        });
    };

    Arch.crawl = function (url) {
        console.log('started to crawl!');
        Arch.queue({"url": url});
        Arch.run();
        //Arch.emit('error', 123, {"test": test});

    };
    return Arch;
};


process.on("uncaughtException", function (err) {
    console.log(err.stack);
});
