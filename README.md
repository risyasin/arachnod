### Arachnod
#### High performance crawler for Nodejs

Powerful & Easy to use web crawler for Nodejs.  [Arachnod](http://arachnod.evrima.net) has been designed for heavy and long running tasks, 
for performance & efective resource usage. For it's goals Arachnod uses [Redis](http://www.redis.io)'s power as a backend. 
Covering all heavy & time consuming tasks such as controlling urls & their tasks to store & distribute information among the Arachnod's child tasks 
(Spiderlings). Arachnod also avoids to use any server-side DOM requiring technics 
such as [jQuery](http://www.jquery.com) with [JSdom](https://github.com/tmpvar/jsdom) to use resources properly. 
Frankly, I have tested JSdom for along time with no luck, always memory leaks & high memory usage. 
Libxml based XPath solutions were not actually real, Instead, Arachnod uses [Cheerio](http://cheeriojs.github.io/cheerio/) for accessing DOM elements. 
Also uses [SuperAgent](https://github.com/visionmedia/superagent) as HTTP Client. 


### How to install 

`$ npm install arachnod`
    
Or via Git
`$ git clone git@github.com:risyasin/arachnod.git`
    
Then, install required Nodejs modules with npm 
`$ npm install`
    
**Please** make sure you have a running [redis-server](https://redis.io) 

### How to use

``` js
var bot = require('arachnod');
    
bot.on('hit', function (doc, $) {
    
    // Do whatever you want to do parsed html content.
    
    var desc = $('article.entry-content').text();
    
    console.log(doc.path, desc);
    
    // if you don't need to follow all links.
    bot.pause();
    
    
});


bot.crawl({
    'redis': '127.0.0.1',
    'parallel': 4,
    'start': 'https://github.com/risyasin/arachnod',
    'resume': false
});


bot.on('error', function (err, task) {
    console.log('Bot error:', err, err.stack, task);
});


bot.on('end', function (err, status) {
    console.log('Bot finished:', err, status);
});
```


### Documentation 


##### Parameters
Parameter Name  | Description
------------- | -------------
**start** | Start url for crawling (Mandatory) 
**parallel** | Number of child processes that will handle network tasks (Default: 8) Do not this more than 20. 
**redis** | Host name or IP address that Redis runs on (Default: 127.0.0.1)
**redisPort**  | Port number for Redis (Default: 6379)
**verbose**  | Arachnod will tell you more, **1** (silence) - **10** (everything). Default: 1.
**resume**  | Resume support, Simply, does not resets queues if there is any. (Default: false) 
**ignorePaths**  | Ignores paths starts with. Must be multiple in array syntax such as `['/blog','/gallery']` 
**ignoreParams**  | Ignores query string parameters, Must be in array syntax. such as `['color','type']`  
**sameDomain**  | Stays in the same hostname. (implemented as of 0.4.4)
**useCookies**  | Using cookies (implemented at 0.4.4 as **cookie** parameter)
**basicAuth**  | Provide basic authentication credentials. `user:pass` 
**obeyRobotsTxt**  | As it's name says. Honors the robots.txt (will be implemented at v0.5) 
 



##### Events
Event Name  | Description
------------- | -------------
**hit** | Emits when a url has been downloaded & processed, sends two parameters in order *doc* Parsed url info, **$** as Cheerio object. 
**error**  | Emits when an error occurs at any level including child processes. Single parameter Error or Exception.  
**end**  | Emits when reached at the end of tasks queue. Return statistics.  
**stats**  | Emits bot stats whenever a child changes it's states (such as downloading or querying queues). Use wisely.  




##### Methods
Method Name  | Description
------------- | -------------
**crawl(Parameters)** | Starts a new crawling session with parameters
**pause()**  | Stops bot but does not delete any task queue.
**resume()**  | Starts back a paused session. Useful to control resource usage in low spec systems (single core etc.). 
**queue(url)**  | Adds given url to task queue. 
**getStats()**  | Returns various statistics such as downloaded, checked, finished url counts, memory size etc. 
 

 
 
##### What's Next
* Regex support for ignore parameters
* Cookie support
* Robots.txt & rel=nofollow support
* Actions for content-type or any given response headers 
* Custom headers
* Custom POST/PUT method queues
* Free-Ride mode (will be fun)
* Stats for each download/hit event
* Plugin support



#### Support 
If you love to use Arachnod. Help me to improve it. 
Feel free to make pull request for anything useful. 


#### License

Copyright 2015-17 yasin inat

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
