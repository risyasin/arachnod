

var bot = require('../index.js'),
    _ = require('lodash'),
    log = console.log;

bot.crawl({
    'redis': 'localhost',
    'parallel': 2,
    //'start': 'https://www.npmjs.com/package/arachnod',
    'start': 'http://doc.gitlab.com/ce/api/',
    'verbose': 1,
    'resume': false
});


var myHit = function (doc, $) {
    /* $ is JQuery like Cheerio object that provides access to DOM*/
    /* doc contains task information & headers of hit. */
    // console.log($('h1.package-name').text().replace(/\r|\n|\t/g,'') + $('li.last-publisher').text().replace(/\r|\n|\t/g,''));


    _.each($('pre.shell > code'), function (el) {
        // log('el:', el.text());
    })
};

bot.on('hit', myHit);

bot.on('error', function (err, task) {
    console.log(['arachnod error:', err, task]);
});

bot.on('end', function (err, status) {
    console.log(['arachnod tasks ended:', err, status]);
});
