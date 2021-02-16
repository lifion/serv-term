# serv-term

[![npm version](https://badge.fury.io/js/serv-term.svg)](http://badge.fury.io/js/serv-term)

## Getting Started

To install the module:

```sh
npm install serv-term --save
```

## Features

## API Reference

<a name="module_serv-term..createServerTerminator"></a>

### serv-term~createServerTerminator(server, options) ⇒ <code>function</code>

Registers connection listeners, and returns a function that when called will close a server and all open connections

**Kind**: inner method of [<code>serv-term</code>](#module_serv-term)  
**Returns**: <code>function</code> - A function to initiate the shutdown of the server

| Param             | Type                                                  | Description                                                   |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| server            | <code>http.Server</code> \| <code>https.Server</code> | The server to be terminated                                   |
| options           | <code>object</code>                                   | Accepts the following options                                 |
| [options.timeout] | <code>number</code>                                   | The duration to wait before forcefully terminating the server |

## License

[MIT](./LICENSE)
