## LivepeerEmitter

LivepeerEmitter is an EventEmitter class

### How to use

```js
export const LivePeerAPI = () => new LivepeerEmitter({ config: main, log });
```


@param `config`

```js


/*
    Configuration store for the dependencies and frame config
*/

const env = process.env.NODE_ENV;
const homeDir = require('os').homedir();
const host = 'http://localhost';
const httpPort = '8935';
const rtmpPort = '1935';
const monitorHost = 'http://viz.livepeer.org:8081/metrics';

const frameConfig = [
    { framerate: 15, keyint: 75 },
    { framerate: 30, keyint: 150 },
    { framerate: 60, keyint: 300 }
];

export default {
    main: { homeDir, frameConfig, rtmpPort, host, httpPort, monitorHost, env }
}
``` 

@param `log`

log is used for debug purpose you can use `js import log from 'electron-log';` in an electron context or build your own log.info function to fit your needs. 


### Events list

Constructor will start a loop to check if livepeer is running and emit two events

```js
self.emit('loading', { type: 'delete/add', key: 1 });
```

until the constructor send loading event with delete type livepeer is not running. 

```js
self.emit('peerCount', { peerCount });
```
 
#### startLivepeer()

emit errors when livepeer stop via 
```js
self.emit('notifier', { error: 2 });
```

#### startFFMpeg()

emit errors when ffmpeg stop via 
```js
self.emit('notifier', { error: 3 });
```

#### getHlsStrmID()

emit the current hlsStrmID 
```js
this.emit('broadcast', { hlsStrmID });
``` 

#### getVideo(strmID)
#### stopLivepeer()
#### stopEmitter()
#### resetLivepeer() 

