'use strict';

const http = require('http');
const https = require('https');
const axios = require('axios').default;
const { promisify } = require('util');
const sinon = require('sinon');
const pem = require('pem');
const KeepAliveHttpAgent = require('agentkeepalive');
const index = require('.');

const delay = promisify(setTimeout);

const serverCreators = {
  http,
  https
};

const sandbox = sinon.createSandbox();

describe('lib/index', () => {
  afterEach(() => {
    sandbox.restore();
  });

  Object.keys(serverCreators).forEach(serverType => {
    const { createServer } = serverCreators[serverType];
    describe(serverType, () => {
      let options = {};
      const httpInstance = axios.create({
        httpAgent: new KeepAliveHttpAgent(),
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
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
        const timeout = 5000;
        await new Promise(resolve => {
          server.listen(3000, () => {
            resolve();
          });
        });
        expect(server.listening).toBe(true);
        const terminate = index.createServerTerminator({ server, timeout });
        await terminate();
        expect(server.listening).toBe(false);
      });

      test('server with no requests and keep alive connections is terminated safely', async () => {
        const server = createServer(options, (req, res) => {
          setTimeout(() => {
            res.end('ok');
          }, 100);
        });
        const timeout = 5000;
        await new Promise(resolve => {
          server.listen(3000, () => {
            resolve();
          });
        });
        expect(server.listening).toBe(true);
        const terminate = index.createServerTerminator({ server, timeout });

        await httpInstance.get(`${serverType}://localhost:${server.address().port}`);
        await terminate();
        expect(server.listening).toBe(false);
      });

      test('server with active request is terminated safely', async () => {
        let setHeader;
        const server = createServer(options, (req, res) => {
          setHeader = sandbox.spy(res, 'setHeader');
          setTimeout(() => {
            res.end('ok');
          }, 1000);
        });
        const timeout = 5000;
        await new Promise(resolve => {
          server.listen(5000, () => {
            resolve();
          });
        });
        expect(server.listening).toBe(true);
        const terminate = index.createServerTerminator({ server, timeout });

        const resultPromise = httpInstance.get(
          `${serverType}://localhost:${server.address().port}`
        );
        await delay(200);
        const terminatePromise = terminate();
        const result = await resultPromise;
        expect(result.status).toBe(200);
        await terminatePromise;
        expect(server.listening).toBe(false);
        expect(setHeader.callCount).toBe(1);
      });

      test('server with active request and headers already sent is not sent additional headers', async () => {
        let setHeader;
        const server = createServer(options, (req, res) => {
          setHeader = sandbox.spy(res, 'setHeader');
          sandbox.stub(res, 'headersSent').value(true);
          setTimeout(() => {
            res.end('ok');
          }, 1000);
        });

        const timeout = 3000;
        await new Promise(resolve => {
          server.listen(5000, () => {
            resolve();
          });
        });
        expect(server.listening).toBe(true);
        const terminate = index.createServerTerminator({ server, timeout });

        const resultPromise = httpInstance.get(
          `${serverType}://localhost:${server.address().port}`
        );
        await delay(200);
        const terminatePromise = terminate();
        const result = await resultPromise;
        expect(result.status).toBe(200);
        await terminatePromise;
        expect(server.listening).toBe(false);
        expect(setHeader.callCount).toBe(0);
      });

      test('server with active request is terminated forcefully if exceeds timeout', async () => {
        const server = createServer(options, (req, res) => {
          setTimeout(() => {
            res.end('ok');
          }, 10000);
        });
        const timeout = 100;
        await new Promise(resolve => {
          server.listen(4000, () => {
            resolve();
          });
        });
        expect(server.listening).toBe(true);
        const terminate = index.createServerTerminator({ server, timeout });

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
        await new Promise(resolve => {
          server.listen(3000, () => {
            resolve();
          });
        });
        expect(server.listening).toBe(true);
        const realServerClose = server.close.bind(server);
        sandbox.stub(server, 'close').callsFake(async () => {
          await new Promise(resolve => realServerClose(resolve));
        });
        const terminate = index.createServerTerminator({ server, timeout });
        await terminate();

        expect(server.listening).toBe(false);
      });

      test('should throw error on server.close error', async () => {
        const server = createServer();
        const timeout = 5000;
        await new Promise(resolve => {
          server.listen(3000, () => {
            resolve();
          });
        });
        expect(server.listening).toBe(true);
        const realServerClose = server.close.bind(server);
        sandbox.stub(server, 'close').callsFake(async fn => {
          await new Promise(resolve => realServerClose(resolve));
          fn(new Error('error on closing'));
        });
        const terminate = index.createServerTerminator({ server, timeout });

        await expect(terminate()).rejects.toThrow();
        expect(server.listening).toBe(false);
      });
    });
  });
});
