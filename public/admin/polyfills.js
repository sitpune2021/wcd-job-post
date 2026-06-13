// Polyfills for older browsers and Windows 7/8 compatibility

// Array.prototype.forEach polyfill
if (!Array.prototype.forEach) {
  Array.prototype.forEach = function(callback, thisArg) {
    var T, k;
    if (this == null) {
      throw new TypeError('this is null or not defined');
    }
    var O = Object(this);
    var len = O.length >>> 0;
    if (typeof callback !== 'function') {
      throw new TypeError(callback + ' is not a function');
    }
    if (arguments.length > 1) {
      T = thisArg;
    }
    k = 0;
    while (k < len) {
      var kValue;
      if (k in O) {
        kValue = O[k];
        callback.call(T, kValue, k, O);
      }
      k++;
    }
  };
}

// Array.prototype.map polyfill
if (!Array.prototype.map) {
  Array.prototype.map = function(callback, thisArg) {
    var T, A, k;
    if (this == null) {
      throw new TypeError('this is null or not defined');
    }
    var O = Object(this);
    var len = O.length >>> 0;
    if (typeof callback !== 'function') {
      throw new TypeError(callback + ' is not a function');
    }
    if (arguments.length > 1) {
      T = thisArg;
    }
    A = new Array(len);
    k = 0;
    while (k < len) {
      var kValue, mappedValue;
      if (k in O) {
        kValue = O[k];
        mappedValue = callback.call(T, kValue, k, O);
        A[k] = mappedValue;
      }
      k++;
    }
    return A;
  };
}

// Array.prototype.filter polyfill
if (!Array.prototype.filter) {
  Array.prototype.filter = function(callback, thisArg) {
    var T, k, value, filtered = [];
    if (this == null) {
      throw new TypeError('this is null or not defined');
    }
    var O = Object(this);
    var len = O.length >>> 0;
    if (typeof callback !== 'function') {
      throw new TypeError(callback + ' is not a function');
    }
    if (arguments.length > 1) {
      T = thisArg;
    }
    k = 0;
    while (k < len) {
      if (k in O) {
        value = O[k];
        if (callback.call(T, value, k, O)) {
          filtered.push(value);
        }
      }
      k++;
    }
    return filtered;
  };
}

// Array.prototype.find polyfill
if (!Array.prototype.find) {
  Array.prototype.find = function(predicate) {
    if (this == null) {
      throw new TypeError('Array.prototype.find called on null or undefined');
    }
    if (typeof predicate !== 'function') {
      throw new TypeError('predicate must be a function');
    }
    var list = Object(this);
    var length = list.length >>> 0;
    var thisArg = arguments[1];
    var value;

    for (var i = 0; i < length; i++) {
      value = list[i];
      if (predicate.call(thisArg, value, i, list)) {
        return value;
      }
    }
    return undefined;
  };
}

// Object.assign polyfill
if (typeof Object.assign !== 'function') {
  Object.assign = function(target, varArgs) {
    if (target == null) {
      throw new TypeError('Cannot convert undefined or null to object');
    }
    var to = Object(target);
    for (var index = 1; index < arguments.length; index++) {
      var nextSource = arguments[index];
      if (nextSource != null) {
        for (var nextKey in nextSource) {
          if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
            to[nextKey] = nextSource[nextKey];
          }
        }
      }
    }
    return to;
  };
}

// String.prototype.includes polyfill
if (!String.prototype.includes) {
  String.prototype.includes = function(search, start) {
    if (typeof start !== 'number') {
      start = 0;
    }
    if (start + search.length > this.length) {
      return false;
    } else {
      return this.indexOf(search, start) !== -1;
    }
  };
}

// String.prototype.trim polyfill
if (!String.prototype.trim) {
  String.prototype.trim = function() {
    return this.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
  };
}

// Promise polyfill (basic implementation)
if (typeof Promise === 'undefined') {
  var PromisePolyfill = function(executor) {
    var self = this;
    self.state = 'pending';
    self.value = undefined;
    self.reason = undefined;
    self.onFulfilled = [];
    self.onRejected = [];

    function resolve(value) {
      if (self.state !== 'pending') return;
      self.state = 'fulfilled';
      self.value = value;
      self.onFulfilled.forEach(function(fn) {
        fn(value);
      });
    }

    function reject(reason) {
      if (self.state !== 'pending') return;
      self.state = 'rejected';
      self.reason = reason;
      self.onRejected.forEach(function(fn) {
        fn(reason);
      });
    }

    try {
      executor(resolve, reject);
    } catch (err) {
      reject(err);
    }
  };

  PromisePolyfill.prototype.then = function(onFulfilled, onRejected) {
    var self = this;
    return new PromisePolyfill(function(resolve, reject) {
      function handle(value) {
        try {
          var result = onFulfilled ? onFulfilled(value) : value;
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }

      function handleErr(reason) {
        try {
          var result = onRejected ? onRejected(reason) : PromisePolyfill.reject(reason);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }

      if (self.state === 'fulfilled') {
        handle(self.value);
      } else if (self.state === 'rejected') {
        handleErr(self.reason);
      } else {
        self.onFulfilled.push(handle);
        self.onRejected.push(handleErr);
      }
    });
  };

  window.Promise = PromisePolyfill;
}

// fetch polyfill (basic implementation using XMLHttpRequest)
if (typeof fetch === 'undefined') {
  window.fetch = function(url, options) {
    options = options || {};
    return new Promise(function(resolve, reject) {
      var request = new XMLHttpRequest();
      request.open(options.method || 'GET', url, true);
      
      if (options.headers) {
        Object.keys(options.headers).forEach(function(key) {
          request.setRequestHeader(key, options.headers[key]);
        });
      }
      
      request.onload = function() {
        if (request.status >= 200 && request.status < 400) {
          resolve({
            status: request.status,
            statusText: request.statusText,
            headers: {
              get: function(name) {
                return request.getResponseHeader(name);
              }
            },
            text: function() {
              return Promise.resolve(request.responseText);
            },
            json: function() {
              return Promise.resolve(JSON.parse(request.responseText));
            }
          });
        } else {
          reject(new Error('Network response was not ok'));
        }
      };
      
      request.onerror = function() {
        reject(new Error('Network request failed'));
      };
      
      request.send(options.body || null);
    });
  };
}

// console polyfill for old browsers
if (!window.console) {
  window.console = {
    log: function() {},
    error: function() {},
    warn: function() {},
    info: function() {}
  };
}

// localStorage polyfill
if (typeof Storage === 'undefined') {
  window.localStorage = {
    getItem: function(key) {
      return this[key] || null;
    },
    setItem: function(key, value) {
      this[key] = value;
    },
    removeItem: function(key) {
      delete this[key];
    },
    clear: function() {
      var self = this;
      Object.keys(self).forEach(function(key) {
        if (key !== 'length' && key !== 'clear' && key !== 'getItem' && key !== 'setItem' && key !== 'removeItem' && key !== 'key') {
          delete self[key];
        }
      });
    }
  };
}

// CustomEvent polyfill
if (typeof CustomEvent !== 'function') {
  function CustomEvent(event, params) {
    params = params || { bubbles: false, cancelable: false, detail: undefined };
    var evt = document.createEvent('CustomEvent');
    evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
    return evt;
  }
  
  CustomEvent.prototype = window.Event.prototype;
  window.CustomEvent = CustomEvent;
}

console.log('Polyfills loaded for older browser compatibility');
