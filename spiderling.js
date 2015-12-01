"use strict";

var ps      = process.argv.splice(2),
    Agent   = require('superagent'),
    Url     = require('url'),
    log     = require('logging').from(__filename),
    _       = require('lodash'),
    rs      = ps[0],
    tasks   = ps[1],
    finished = ps[2],
    verbosity = ps[3] || 0,
    rc      = require('redis').createClient(6379, rs),
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
    };


/**
 * Task fetcher from redis.
 * @param cb
 */
function getTask(cb) {
    rc.spop(tasks, function (err, task) {
        if (verbosity > 3){ log(['gottask', task]); }
        if (!_.isNull(task)){
            getTask.retry = 0;
            run.status = 'gottask';
            task = JSON.parse(task);
            cb(task);
        } else {
            if (getTask.retry === 20) {
                process.send({'cmd': 'exit', 'pid': process.pid});
                setTimeout(process.exit, 500);
                log(process.pid + ' will exit in 500 -- STOP');
            } else {
                run.status = 'idle';
                if (verbosity > 5){ log(['status', run.status]); }
                setTimeout(run, 500);
                log(process.pid + ' will re-run in 500');
                getTask.retry++;
            }
        }
    });
}

// retry count, when limit reached child dies.
getTask.retry = 0;


/**
 * Task checker
 */
function checkTasks() {
    rc.scard(tasks, function (err, tl) {
        rc.scard(finished, function (err, fl) {
            process.send({'cmd':'stat'});
            if (verbosity > 5){ log(['queue', 'fin: ' + fl, 't: ' + tl]); }
            if (tl>0){ setTimeout(run, 500); }
        });
    });
}


/**
 * Url fetcher
 * @param task
 * @param cb
 */
function getUrl(task, cb) {
    run.status = 'downloading';
    if (verbosity > 5){ log(['status', run.status, task.url]); }
    cfg.headers['User-Agent'] = _.sample(cfg.userAgents.chrome, 1);
    Agent.get(task.url)
        .set(cfg.headers)
        .end(function(result){
            if (verbosity > 5){ log(['downloaded', task.url, result.headers['content-type']]); }
            if (result.headers['content-type'].slice(0,9) === 'text/html'){
                cb(null, task, result);
            }
            result = null;
        });
}

/**
 * Task retry implementation.
 * @param task
 * @param code
 */
function taskRetry(task, code) {
    task.lastResponse = code;
    if (task.retry){ task.retry++; } else { task.retry = 1; }
    setTimeout(function () {
        getUrl(task, processResponse);
    }, 10000);
}


/**
 * Response handler. capture everything it needs then send it to parent.
 * @param err
 * @param task
 * @param result
 */
function processResponse(err, task, result) {
    if (err){
        process.send({'error': err});
        run.status = 'retrying';
        taskRetry(task);
    } else {
        if (verbosity > 5){ log(['processing', task.url, result.statusCode]); }
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
}


/**
 * Run fn to control retries & init
 */
function run() {
    getTask(function (task) {
        if (!_.isUndefined(task) && task.url){
            getUrl(task, processResponse);
        }
    });
}

// first state.
run.status = 'init';


/**
 * Task finish handler
 * @param taskData
 */
function finish(taskData) {
    if (taskData.url){
        rc.sadd(finished, JSON.stringify(taskData));
        checkTasks();
    }
}


process.on('message', function (msg) {
    if (msg.cmd && msg.cmd === 'run'){
        run();
    }
});

process.on('disconnect', function() {
    // when parent exit
    process.exit(0);
});

process.on('uncaughtException', function (err) {
    console.log(err.stack);
});
