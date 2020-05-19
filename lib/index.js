'use strict';

const http = require('http');
const { promisify } = require('util');

const delay = promisify(setTimeout);
const sockets = new Set();
const secureSockets = new Set();

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
    throw new Error('shutdown timeout exceeded');
  });

  return Promise.race([serverClosure, timeoutDelay]);
}

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
