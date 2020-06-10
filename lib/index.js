'use strict';

const http = require('http');
const { promisify } = require('util');

const delay = promisify(setTimeout);
const sockets = new Set();
const secureSockets = new Set();

const shutdownTimeoutExceeded = 'shutdown timeout exceeded';

/**
 * Closes a socket and removes it from its socket set
 *
 * @param {Socket} socket
 * @param {Set<Socket>} socketSet
 */
function closeSocket(socket, socketSet) {
  const serverResponse = socket._httpMessage; // eslint-disable-line no-underscore-dangle

  if (serverResponse) {
    if (!serverResponse.headersSent) {
      serverResponse.setHeader('connection', 'close');
    }
  } else {
    socketSet.delete(socket);
    socket.destroy();
  }
}

/**
 * Initiates shutdown of an http or https server
 *
 * @param {http.Server|https.Server} options.server - The server to be terminated
 * @param {number} options.timeout - The duration to wait before forcefully terminating the server
 */
async function terminateServer({ server, timeout }) {
  const serverClosure = new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
      }
      resolve();
    });
  });

  for (const socket of secureSockets) {
    closeSocket(socket, secureSockets);
  }

  for (const socket of sockets) {
    if (socket.server instanceof http.Server) {
      closeSocket(socket, sockets);
    }
  }

  const timeoutDelay = delay(timeout).then(() => {
    throw new Error(shutdownTimeoutExceeded);
  });

  try {
    await Promise.race([serverClosure, timeoutDelay]);
  } catch (err) {
    if (err.message !== shutdownTimeoutExceeded) {
      throw err;
    }
    if (sockets.size) {
      for (const socket of sockets) {
        socket.destroy();
        sockets.delete(socket);
      }
    }

    if (secureSockets.size) {
      for (const socket of secureSockets) {
        socket.destroy();
        secureSockets.delete(socket);
      }
    }
  }
}

/**
 * Registers connection listeners, and returns a function that when called will close a server and all open connections
 *
 * @param {http.Server|https.Server} options.server - The server to be terminated
 * @param {number} options.timeout - The duration to wait before forcefully terminating the server
 */
function createServerTerminator({ server, timeout }) {
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  });

  server.on('secureConnection', socket => {
    secureSockets.add(socket);
    socket.once('close', () => {
      secureSockets.delete(socket);
    });
  });

  return () => terminateServer({ server, timeout });
}

module.exports = {
  createServerTerminator
};
