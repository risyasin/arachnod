### Arachnod
#### High performance crawler for Nodejs

Powerful & Easy to use web crawler for Nodejs.  [Arachnod](http://arachnod.evrima.net) has been designed for heavy long runing tasks, 
for performance & efective resource usage. For it's goals Arachnod uses [Redis](http://www.redis.io)'s power as a backend. 
Covering all heavy & time consuming tasks such as controlling urls & their tasks to store & distribute information among the Arachnod's child tasks 
(Spiderlings). Arachnod also avoids to use any server-side DOM requiring technics 
such as [jQuery](http://www.jquery.com) with [JSdom](https://github.com/tmpvar/jsdom) to use resources properly. 
Frankly tested JSdom for along time with no luck, always memory leaks & high memory usage. 
Libxml based XPath solutions were not actually real. Arachnod uses [Cheerio](http://cheeriojs.github.io/cheerio/) for accessing DOM elements. 
Also uses [SuperAgent](https://github.com/visionmedia/superagent) as HTTP Client. 


###### How to install 
* via NPM 
`npm install arachnod`

* via Git 
`git clone https://github.com/risyasin/arachnod.git`

###### How to use

```js

    var bot = require('arachnod');
    
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
		console.log($('#readme a').text());
    });
    
    bot.on('error', function (err, task) {
        console.log(['arachnod error:', task]);
    });
    
    bot.on('end', function (err, status) {
        console.log(['arachnod tasks ended:', err, status]);
    });
```