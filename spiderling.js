"use strict";

var ps      = process.argv.splice(2),
    Agent   = require('superagent'),
    log     = require('logging').from(__filename),
    _       = require('lodash'),
    rs      = ps[0],
    tasks   = ps[1],
    finished = ps[2],
    verbosity = ps[3] || 0,
    retry   = 0,
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
        
        if (err){ 
            log('getTask', err); 
        }
        
        if (verbosity > 3){ 
            log('gottask', process.pid, task);
        }

        if (!_.isNull(task)) {
            retry = 0;
            run.status = 'gottask';
            task = JSON.parse(task);
            cb(task);
        } else {
            run.status = 'idle';
            if (verbosity > 5) { 
                log('status', process.pid, run.status); 
            }
            setTimeout(run, 200);
            retry++;
        }

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

    _.extend(cfg.headers, {
        'User-Agent': _.sample(cfg.userAgents.chrome, 1),
        'Expires':'-1',
        'Cache-Control': 'no-cache,no-store,must-revalidate,max-age=-1,private'
    });

    Agent.get(task.url).set(cfg.headers).timeout(5000);

    if(!_.isNull(task.auth)) {
        var user = task.auth.split(':');
        Agent.auth(user, pass);
    }

    if(!_.isNull(task.cookie)) {
        Agent.set('Cookie', task.cookie);
    }

    Agent.on('error', function (err) { 
        process.send({'cmd':'error','error': err,'task': task}); 
    });
    
    Agent.end(function(err, result){
        if (verbosity > 5){ log(['downloaded', task.url, result.headers['content-type']]); }
        cb(err, task, result);
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
    if (task.retry > 5){
        run.status = 'aborted';
        process.send({'cmd':'error','error': 'task aborted', 'task': task });
    } else {
        run.status = 'retrying 2';
        setTimeout(function () {
            getUrl(task, processResponse);
        }, 500);
    }
}


/**
 * Response handler. capture everything it needs then send it to parent.
 * @param err
 * @param task
 * @param result
 */
function processResponse(err, task, result) {
    if (err) {
        process.send({'cmd': 'error', 'error': err, 'task': task});
        run.status = 'retrying';
        taskRetry(task, result.status);

    } else {
        
        run.status = 'processing';
        
        if (verbosity > 5) { 
            log('processing', task.url, result.statusCode); 
        }

        process.send({
            'cmd': 'hit',
            'task': task,
            'result': {
                'path': result.req.path,
                'status': result.statusCode,
                'headers': result.headers,
                'text': result.text
        }});

        process.send({
            'cmd': 'cookie',
            'value': result.headers.cookie
        });

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
 * @param task
 */
function finish(task) {
    if (task.url){
        run.status = 'finished-last';
        rc.sadd(finished, JSON.stringify(task));
        setTimeout(run, 200);
    }
}


// Idle checker
setInterval(function () {
    if (retry > 20) {
        process.send({'cmd': 'exit', 'pid': process.pid});
        process.exit(0);
    }
}, 100);


process.send({'cmd':'ready', 'pid': process.pid});

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
    process.send({'cmd':'error', 'error': err});
});
