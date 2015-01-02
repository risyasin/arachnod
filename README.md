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
    npm install arachnod
    
* via Git 
    git clone http://git.evrima.net/dev/arachnod.git
    

###### How to use

```javascript

    var bot = require('arachnod')('127.0.0.1');
    
    bot.on('hit', function (doc, $, text) {
        $("a").each(function() {
        
        });
    });

    bot.on('error', function (err, doc) {
        console.log(['Bot error', err, doc]);
    });

    bot.crawl('https://www.google.com/?q=nodejs+arachnod', function (status) {
        tcb(null, true);
    });