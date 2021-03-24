'use strict';

const KeepAliveHttpAgent = require('agentkeepalive');
const axios = require('axios').default;
const http = require('http');
const https = require('https');
const pem = require('pem');
const { promisify } = require('util');

const index = require('.');

const delay = promisify(setTimeout);
const serverCreators = { http, https };

describe('lib/index', () => {
  describe('validation', () => {
    test('should throw error when not passed arguments', () => {
      expect(() => index.createServerTerminator()).toThrow();
    });

    test('should not throw error when passed http server', () => {
      const terminate = index.createServerTerminator(http.createServer());
      expect(typeof terminate).toBe('function');
    });

    test('should not throw error when passed https server', () => {
      const terminate = index.createServerTerminator(http.createServer());
      expect(typeof terminate).toBe('function');
    });

    test('should not throw error when passed empty options', () => {
      const terminate = index.createServerTerminator(http.createServer());
      expect(typeof terminate).toBe('function');
    });

    test('should throw error when passed a negative timeout', () => {
      expect(() => index.createServerTerminator(http.createServer(), { timeout: -10 })).toThrow();
    });

    test('should throw error when passed a 0 timeout', () => {
      expect(() => index.createServerTerminator(http.createServer(), { timeout: 0 })).toThrow();
    });

    test('should throw error when passed a non-number timeout', () => {
      expect(() =>
        index.createServerTerminator(http.createServer(), { timeout: 'timeout' })
      ).toThrow();
    });

    test('should throw error when passed a NaN timeout', () => {
      expect(() =>
        index.createServerTerminator(http.createServer(), { timeout: Number.NaN })
      ).toThrow();
    });
  });

  describe.each(Object.keys(serverCreators).map((i) => [i]))('%s', (serverType) => {
    let options = {};
    const { createServer } = serverCreators[serverType];
    const httpInstance = axios.create({
      httpAgent: new KeepAliveHttpAgent(),
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      proxy: false
    });

    beforeAll(async () => {
      if (serverType === 'https') {
        const { certificate, csr, serviceKey } = await promisify(pem.createCertificate)({
          days: 365,
          selfSigned: true
        });

        options = {
          ca: csr,
          cert: certificate,
          key: serviceKey
        };
      }
    });

    test('server with no requests is terminated safely', async () => {
      const server = createServer();
      const timeout = 2000;
      await new Promise((resolve) => {
        server.listen(0, () => {
          resolve();
        });
      });
      expect(server.listening).toBe(true);
      const terminate = index.createServerTerminator(server, { timeout });
      await terminate();
      expect(server.listening).toBe(false);
    });

    test('server with no requests and keep alive connections is terminated safely', async () => {
      const server = createServer(options, (req, res) => {
        setTimeout(() => {
          res.end('ok');
        }, 100);
      });
      const timeout = 2000;
      await new Promise((resolve) => {
        server.listen(0, () => {
          resolve();
        });
      });

      expect(server.listening).toBe(true);
      const terminate = index.createServerTerminator(server, { timeout });

      await httpInstance.get(`${serverType}://localhost:${server.address().port}`);
      await terminate();
      expect(server.listening).toBe(false);
    });

    test('server with active request is terminated safely', async () => {
      let setHeader;
      const server = createServer(options, (req, res) => {
        setHeader = jest.spyOn(res, 'setHeader');
        setTimeout(() => {
          res.end('ok');
        }, 1000);
      });
      const timeout = 2000;
      await new Promise((resolve) => {
        server.listen(0, () => {
          resolve();
        });
      });
      expect(server.listening).toBe(true);
      const terminate = index.createServerTerminator(server, { timeout });

      const resultPromise = httpInstance.get(`${serverType}://localhost:${server.address().port}`);
      await delay(200);
      const terminatePromise = terminate();
      const result = await resultPromise;
      expect(result.status).toBe(200);
      await terminatePromise;
      expect(server.listening).toBe(false);
      expect(setHeader.mock.calls.length).toBe(1);
    });

    test('server with active request and headers already sent is not sent additional headers', async () => {
      let setHeader;
      const server = createServer(options, (req, res) => {
        setHeader = jest.spyOn(res, 'setHeader');
        jest.spyOn(res, 'headersSent', 'get').mockReturnValue(true);
        setTimeout(() => {
          res.end('ok');
        }, 1000);
      });

      const timeout = 3000;
      await new Promise((resolve) => {
        server.listen(0, () => {
          resolve();
        });
      });
      expect(server.listening).toBe(true);
      const terminate = index.createServerTerminator(server, { timeout });

      const resultPromise = httpInstance.get(`${serverType}://localhost:${server.address().port}`);
      await delay(200);
      const terminatePromise = terminate();
      const result = await resultPromise;
      expect(result.status).toBe(200);
      await terminatePromise;
      expect(server.listening).toBe(false);
      expect(setHeader.mock.calls.length).toBe(0);
    });

    test('server with active request is terminated forcefully if exceeds timeout', async () => {
      const server = createServer(options, (req, res) => {
        setTimeout(() => {
          res.end('ok');
        }, 10000);
      });
      const timeout = 100;
      await new Promise((resolve) => {
        server.listen(4000, () => {
          resolve();
        });
      });
      expect(server.listening).toBe(true);
      const terminate = index.createServerTerminator(server, { timeout });

      const responsePromise = httpInstance.get(
        `${serverType}://localhost:${server.address().port}`
      );
      await delay(200);
      const terminatePromise = terminate();
      await terminatePromise;
      expect(server.listening).toBe(false);

      await expect(responsePromise).rejects.toThrow();
    });

    test('server without active request is terminated forcefully if exceeds timeout', async () => {
      const server = createServer();
      const timeout = 1000;
      await new Promise((resolve) => {
        server.listen(0, () => {
          resolve();
        });
      });
      expect(server.listening).toBe(true);
      const realServerClose = server.close.bind(server);
      jest.spyOn(server, 'close').mockImplementation(async () => {
        await new Promise((resolve) => realServerClose(resolve));
      });
      const terminate = index.createServerTerminator(server, { timeout });
      await terminate();

      expect(server.listening).toBe(false);
    });

    test('should throw error on server.close error', async () => {
      const server = createServer();
      const timeout = 2000;
      await new Promise((resolve) => {
        server.listen(0, () => {
          resolve();
        });
      });
      expect(server.listening).toBe(true);
      const realServerClose = server.close.bind(server);

      jest.spyOn(server, 'close').mockImplementation(async (fn) => {
        await new Promise((resolve) => realServerClose(resolve));
        fn(new Error('error on closing'));
      });
      const terminate = index.createServerTerminator(server, { timeout });

      await expect(terminate()).rejects.toThrow();
      expect(server.listening).toBe(false);
    });
  });
});
