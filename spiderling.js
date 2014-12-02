/*jshint -W079 */
"use strict";

var Url     = require("url"),
    Agent   = require("superagent"),
    _       = require("underscore"),
    status  = { "set": "idle" },
    Arch    = { "cfg": {}, cache: [] };

try {
    var defaults = require(__dirname + "/defaults.json");
    Arch.cfg = _.extend(Arch.cfg, defaults);
} catch(e) { throw console.log(['Unable to read defaults file [defaults.json]', e]); }


Arch.headers = (function () {
    // @Todo: Auto generation of Accept headers by task
    // @Todo: Auto generation of Accept=Language headers by configuration
    return {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip,deflate,sdch",
        "Accept-Language": "en-US,en;q=0.8,tr;q=0.6",
        "User-Agent": Arch.cfg.userAgents.arachnod,
        "Referer": "http://www.google.com/",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": 0
    };
}());

Arch.queue = function (taskData) {
    if (taskData.url){
        if (_.indexOf(Arch.cache, taskData.url) === -1){
            var taskStr = JSON.stringify(taskData);
            Arch.rc.sismember(Arch.cfg.finished, taskStr, function (err, res) {
                if (!res){
                    Arch.rc.sadd(Arch.cfg.tasks, taskStr);
                    Arch.cache.push(taskData.url);
                }
            });
        }
    }
};

Arch.finish = function (taskData) {
    if (taskData.url){
        Arch.rc.sadd(Arch.cfg.finished, JSON.stringify(taskData));
        Arch.checkTasks();
    }
};

Arch.checkTasks = function () {
    Arch.rc.scard(Arch.cfg.tasks, function (err, tl) {
        Arch.rc.scard(Arch.cfg.finished, function (err, fl) {
            if (fl === tl){ process.send({ cmd: 'end' }); }
        });
    });
};

Arch.getTask = function (cb) {
    Arch.rc.spop(Arch.cfg.tasks, function (err, task) {
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
    process.send({ status: status });
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
    console.log(['task retry', task]);
    Arch.setStatus("retrying");
    setTimeout(function () {
        Arch.runTask(task, Arch.processResponse);
    }, 30000);
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
            process.send({ "doc": doc, "text": result.res.text });
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


Arch.run();

process.on("uncaughtException", function (err) { console.log(["ues", err.stack]); });