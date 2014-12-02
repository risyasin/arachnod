"use strict";

var os      = require("os"),
    cp      = require("child_process"),
    ee      = require("eventemitter2").EventEmitter2,
    _       = require("underscore"),
    cheerio = require("cheerio"),
    Arch    = { "version": "0.1.0", "cfg": {} };

module.exports = (function () {
    var status = {
            "set": "init",
            "startTime": Date.now(),
            "stop": false
        },
        slings = {},
        userf = {};

    Arch.init = function () {
        Arch.cfg.cpus = os.cpus();

        try {
            var defaults = require(__dirname + "/defaults.json");
            Arch.cfg = _.extend(Arch.cfg, defaults);
        } catch(e) { throw console.log(['Unable to read defaults file [defaults.json]', e]); }

        Arch.rc = redis.createClient(Arch.cfg.redis.port, Arch.cfg.redis.server, Arch.cfg.redis.options);

        if (!Arch.cfg.options.resume){
            Arch.rc.del(Arch.cfg.tasks, function (err, rt) {
                if (err) { throw err; }
                Arch.rc.del(Arch.cfg.finished, function (err, rf) {
                    if (err) { throw err; }
                    console.log('Previous task canceled! ' + rt + ' - ' + rf);
                });
            });
        }
    };

    Arch.forkMsg = function (m, pid) {
        if (m.doc && m.text){
            userf.hit(null, m.doc , cheerio.load(m.text));
        }
        if (m.cmd && m.cmd === 'end'){
            if (_.keys(slings).length > 1){
                pid.kill();
            } else {
                userf.end(null, Arch.finished);
            }
        }
    };

    Arch.crawl = function () {
        status.set = "forking";
        _.each(Arch.cfg.cpus, function (cpu, i) {
            // console.log('forked ' + i);
            slings[i] = cp.fork(__dirname + "/spiderling.js");
            slings[i].on('message', function (m) {
                Arch.forkMsg(m, slings[i].pid);
                m = null;
            });
        });
        // Arch.checkTasks();
    };

    Arch[status.set]();

    process.on('SIGINT', function() {
        _.each(slings, function (cp, i) { cp.kill(); });
        process.exit();
    });

    return {
        "crawl": function (params) {
            Arch.cfg.options = _.extend(Arch.cfg.options, params.cfg);
            if (typeof params.start === "string"){
                Arch.rc.sadd(Arch.cfg.tasks, JSON.stringify({ "url": params.start}));
            }
            if (_.isArray(params.start)){
                _.each(params.start, function (val) {
                    Arch.rc.sadd(Arch.cfg.tasks, JSON.stringify({ "url": val}));
                });
            }
            userf = _.extend(userf, params);
            //console.log(['crawl call', slings]);
            Arch.crawl();
        }
    };

}());

process.on("uncaughtException", function (err) { console.log(["ue", err.stack]); });
