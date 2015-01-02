"use strict";

var ps      = process.argv.splice(2),
    redis   = require("redis"),
    Agent   = require("superagent"),
    Url     = require("url"),
    _       = require("underscore"),
    rs      = ps[0],
    status  = "init",
    tasks   = ps[1],
    finished = ps[2],
    verbosity = ps[3] || 0,
    nullCounter = 0,
    rc      = redis.createClient(6379, rs),
    cfg = {
        "userAgents": {
            "googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
            "yandex": "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
            "bing": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
            "firefox": "Mozilla/5.0 (Windows NT 5.1; rv:31.0) Gecko/20100101 Firefox/30.2",
            "chrome": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/36.0.1985.67 Safari/537.36",
            "ie": "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; WOW64; Trident/6.0)",
            "ie10": "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; WOW64; Trident/6.0)",
            "ie9": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 7.1; Trident/5.0)",
            "ie8": "Mozilla/5.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/4.0; GTB7.4; InfoPath.2; SV1; .NET CLR 3.3.69573; WOW64; en-US)",
            "ie7": "Mozilla/5.0 (Windows; U; MSIE 7.0; Windows NT 6.0; en-US)",
            "ie6": "Mozilla/4.0 (compatible; MSIE 6.01; Windows NT 6.0)",
            "opera": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/28.0.1500.52 Safari/537.36 OPR/15.0.1147.100",
            "safari": "Mozilla/5.0 (iPad; CPU OS 6_0 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/6.0 Mobile/10A5355d Safari/8536.25"
        },
        "headers" : {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Encoding": "gzip,deflate,sdch",
            "Accept-Language": "en-US,en;q=0.8,tr;q=0.6",
            "User-Agent": "Mozilla/5.0 (compatible; Arachnod/0.1; Bot/0.1; +http://arachnod.evrima.net/)",
            "Referer": "http://www.google.com/",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": 0
        }
    },
    getTask = function (cb) {
        rc.spop(tasks, function (err, task) {
            if (verbosity > 3){ console.dir(['gottask', task]); }
            if (task !== null){
                nullCounter = 0;
                status = 'gottask';
                task = JSON.parse(task);
                cb(task);
            } else {
                if (nullCounter === 20) {
                    process.send({'cmd': 'exit', 'pid': process.pid});
                    setTimeout(process.exit, 500);
                } else {
                    status = 'idle';
                    if (verbosity > 5){ console.dir(['status', status]); }
                    setTimeout(run, 500);
                    nullCounter++;
                }
            }
        });
    },
    checkTasks = function () {
        rc.scard(tasks, function (err, tl) {
            rc.scard(finished, function (err, fl) {
                //console.log(['scard task', err, tl]);
                process.send({'cmd':'stat'});
                if (verbosity > 5){ console.dir(['queue', 'fin: ' + fl, 't: ' + tl]); }
                if (tl>0){ setTimeout(run, 500); }
            });
        });
    },
    getUrl = function (task, cb) {
        status = 'downloading';
        if (verbosity > 5){ console.dir(['status', status, task.url]); }
        // firefox
        cfg.headers['User-Agent'] = cfg.userAgents.chrome;
        Agent.get(task.url)
            .set(cfg.headers)
            .end(function(result){
                if (verbosity > 5){ console.dir(['downloaded', task.url]); }
                cb(null, task, result);
                result = null;
            });
    },
    taskRetry = function (task, code) {
        task.lastResponse = code;
        if (task.retry){ task.retry++; } else { task.retry = 1; }
        setTimeout(function () {
            getUrl(task, processResponse);
        }, 10000);
    },
    processResponse = function (err, task, result) {
        if (err){
            process.send({'error': err});
            status = 'retrying';
            taskRetry(task);
        } else {
            if (verbosity > 5){ console.dir(['processing', task.url, result.statusCode]); }
            process.send({
                'cmd': 'hit',
                'task': task,
                'result': {
                    'path': result.req.path,
                    'status': result.statusCode,
                    'headers': result.headers,
                    'text': result.text
            }});
            finish(task);
        }
    },
    run = function () {
        getTask(function (task) {
            if (typeof task !== 'undefined' && task.url){
                getUrl(task, processResponse);
            }
        });
    },
    finish = function (taskData) {
        if (taskData.url){
            rc.sadd(finished, JSON.stringify(taskData));
            checkTasks();
        }
    };


process.on('message', function (msg) {
    if (msg.cmd && msg.cmd === 'run'){
        run();
    }
});

process.on('disconnect', function() {
    // when parent exit
    process.exit(0);
});

process.on("uncaughtException", function (err) {
    console.log(err.stack);
});
