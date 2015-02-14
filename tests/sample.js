

var bot = require('../index.js');

bot.crawl({
    'redis': 'localhost',
    'parallel': 4,
    'start': 'https://www.npmjs.com/package/arachnod',
    'verbose': 1,
    'ignorePaths': ['/list-of-paths/should-be-ignored'],
    'resume': false
});

bot.on('hit', function (doc, $) {
    /* $ is JQuery like Cheerio object that provides access to DOM*/
    /* doc contains task information & headers of hit. */
    console.log($('#readme p').text());
});

bot.on('stats', function (task) {
    console.log(['arachnod stat:', task]);
});

bot.on('error', function (err, task) {
    console.log(['arachnod error:', task]);
});

bot.on('end', function (err, status) {
    console.log(['arachnod tasks ended:', err, status]);
});
