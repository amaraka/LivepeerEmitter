import { spawn } from 'child_process';
import request from 'request';
import shell from 'shelljs';
import rimraf from 'rimraf';

const EventEmitter = require('events');
/* Handle binaries paths */
const livepeer = require('livepeer-static').path;
const ffmpeg = require('ffmpeg-static').path;

const paths = { livepeer, ffmpeg };

const transformBinaryPath = (name) => {
  return paths[name].replace('bin', `node_modules/${name}-static/bin`).replace('app.asar', 'app.asar.unpacked');
};

const cleanPath = (path, bin) => {
  return path.replace('LivepeerEmitter/lib', bin);
};

class LivepeerEmitter extends EventEmitter {
  constructor({ config, log }) {
    super();
    // global shared object

    this.proc = { ffmpegProc: null, livepeerProc: null };
    this.userStopFFmpeg = false;
    this.log = log;
    this.config = config;
    this.path = {};

    if (config.env === 'development') {
      this.path.livepeerPath = cleanPath(paths.livepeer, 'livepeer-static');
      this.path.ffmpegPath = cleanPath(paths.ffmpeg, 'ffmpeg-static');
    } else {
      this.path.livepeerPath = cleanPath(transformBinaryPath('livepeer'), 'livepeer-static');
      this.path.ffmpegPath = cleanPath(transformBinaryPath('ffmpeg'), 'ffmpeg-static');
    }

    const self = this;

    this.checkIfRunning = setInterval(
    () => {
      request(`${config.host}:${config.httpPort}/peersCount`, (err, res, body) => {
        if (err != null) {
          if (err.code === 'ECONNREFUSED') {
            self.emit('loading', { type: 'add', key: 1 });
          }
          return;
        }
        const peerCount = JSON.parse(body).count;

        self.emit('loading', { type: 'delete', key: 1 });
        self.emit('peerCount', { peerCount });
      });
    }, 1500);

  }

  stopEmitter() {
    clearInterval(this.checkIfRunning);
  }

  startLivepeer() {
    const { host, httpPort, monitorHost } = this.config;
    const self = this;

    return request(`${host}:${httpPort}`, (err) => {
      if (err == null) {
        self.proc.livepeerProc = 'local';
        self.log.info('LivePeer is already running.');
      } else if (self.proc.livepeerProc == null) {
        const args = [
          '-monitor',
          '-monitorhost', monitorHost];

        const livepeerProc = spawn(self.path.livepeerPath, args);

        self.proc.livepeerProc = livepeerProc;

        livepeerProc.stdout.on('data', (data) => {
          self.log.info(`stdout: ${data}`);
        });

        livepeerProc.stderr.on('data', (data) => {
          self.log.info(`stderr: ${data}`);
        });

        livepeerProc.on('close', (code) => {
          self.log.info(`livepeer child process exited with code ${code}`);
          self.emit('notifier', { error: 2 });
        });

        self.log.info('Livepeer running on port 8935');
      }
    });
  }

  stopLivepeer() {
    this.log.info('Stopping Livepeer');
    const livepeerProc = this.proc.livepeerProc;

    if (livepeerProc != null && livepeerProc !== 'local') {
      this.log.info(`Sending SIGTERM to ${livepeerProc.pid}`);
      this.proc.livepeerProc.kill();
      this.proc.livepeerProc = null;
    }

  }

  resetLivepeer() {
    const { homeDir } = this.config;

    this.log.info('ResetLivepeer - Deleting Livepeer datadir');

    rimraf(`${homeDir}/Livepeer/livepeernet/`, () => { this.log.info('Removed livepeer dir'); });
    shell.mkdir('-p', `${homeDir}/Livepeer/livepeernet/`);
    this.stopLivepeer();

    return this.startLivepeer();

  }

  getHlsStrmID() {
    const self = this;
    const { host, httpPort } = this.config;

    request(`${host}:${httpPort}/streamID`, (err, res, hlsStrmID) => {
      self.log.info(err);
      if (hlsStrmID === '') {
        setTimeout(() => self.getHlsStrmID(), 1000);
        return;
      }
      this.emit('broadcast', { hlsStrmID });
    });
  }

  getVideo(strmID) {
    const { host, httpPort } = this.config;
    const self = this;

    request(`${host}:${httpPort}/stream/${strmID}.m3u8`, (err, res, body) => {
      if (!body) {
        self.log.info(err);
        return;
      }
    });
  }

  startFFMpeg(configIdx = 0) {
    const self = this;

    return new Promise((resolve, reject) => {
      const { frameConfig, rtmpPort } = self.config;

      self.log.info(`Launching FFmpeg with config: ${configIdx}`);
      self.userStopFFmpeg = false;  /* reset !!*/

      const framerate = frameConfig[configIdx].framerate;
      const keyint = frameConfig[configIdx].keyint;
      const FFMPeArgs = [
        '-f', 'avfoundation',
        '-framerate', framerate,
        '-pixel_format', 'uyvy422',
        '-i', '0:0',
        '-vcodec', 'libx264',
        '-tune', 'zerolatency',
        '-b', '900k',
        '-x264-params', `keyint=${keyint}:min-keyint=${keyint}`,
        '-acodec', 'aac',
        '-ac', '1',
        '-b:a', '96k',
        '-f', 'flv',
        `rtmp://localhost:${rtmpPort}/movie`];

      const broadcastProc = spawn(self.path.ffmpegPath, FFMPeArgs);

      self.proc.ffmpegProc = broadcastProc;

      resolve({ success: 'ok' });

      broadcastProc.stdout.on('data', (data) => {
        self.log.info(`stdout: ${data}`);
        return;
      });

      broadcastProc.stderr.on('data', (data) => {
        // Don't do anything here, because ffmpeg mistakenly outputs everything to stderr
        self.log.info(`stderr: ${data}`);
        return;
      });

      broadcastProc.on('close', (code, signal) => {
        if (self.userStopFFmpeg) {
          return self.log.info('ffmpeg - terminated by the user (stopFFMpeg)');
        }
        self.log.info(`ffmpeg ~ ${FFMPeArgs.join(' ')}`);
        self.log.info(`ffmpeg ${code} ~ child process terminated due to receipt of signal ${signal}`);

        if (configIdx < frameConfig.length - 1) {
          return self.startFFMpeg(configIdx + 1);
        }
        self.emit('notifier', { error: 3 });
        return reject({ message: 'FFMpeg process closed' });

      });
    });

  }

  stopFFMpeg() {
    const self = this;

    return new Promise((resolve) => {
      const ffmpegProc = self.proc.ffmpegProc;

      if (ffmpegProc != null) {
        self.log.info(`Killing FFMPeg pid: ${ffmpegProc.pid}`);
        self.userStopFFmpeg = true;
        self.proc.ffmpegProc.kill();
        self.proc.ffmpegProc = null;
      }

      resolve('FFMpeg Closed');
    });
  }

}

module.exports = LivepeerEmitter;
