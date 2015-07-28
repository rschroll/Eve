/// <reference path="uiEditorRenderer.ts" />
/// <reference path="api.ts" />
module client {
  declare var dispatcher;
  declare var DEBUG;
  declare var CBOR;
  declare var uuid;

  var ixer = api.ixer;
  var zip = api.zip;

  function now() {
    if (window.performance) {
      return window.performance.now();
    }
    return (new Date()).getTime();
  }

  export function nukeTable(viewId) { // from orbit
    var fieldIds = api.code.sortedViewFields(viewId);
    var toRemove = api.ixer.facts(viewId);
    sendToServer({ changes: [[viewId, fieldIds, [], toRemove]]}, true);
  }



  function formatTime(time) {
    time = time || new Date();
    return pad("", time.getHours(), "0", 2) + ":" + pad("", time.getMinutes(), "0", 2) + ":" + pad("", time.getSeconds(), "0", 2);
  }

  function pad(left, right, pad, length) {
    left = "" + left;
    right = "" + right;
    pad = (pad !== undefined) ? pad : " ";
    length = (length !== undefined) ? length : 120;

    var padding = "";
    var delta = length - left.length - right.length;
    if (delta > 0) {
      padding = new Array(delta + 1).join(pad);
    }
    return left + padding + right;
  }

  function writeDataToConsole(data, verbosity) {
    var console: any = window.console;
    verbosity = +verbosity;
    data.changes.forEach(function(change) {
      if (change[2].length || change[3].length) {
        if (verbosity == 1) {
          console.log(" ", change[0], "+" + change[2].length + "/-" + change[3].length);
        }
        if (verbosity == 2) {
          console.log(" ", change[0], "+" + change[2].length + "/-" + change[3].length,
            { fields: change[1], inserts: change[2], removes: change[3] });
        }
        if (verbosity == 3) {
          console.log(" ", change[0], "+" + change[2].length + "/-" + change[3].length);
          console.groupCollapsed("   inserts", change[1]);
          console.table(change[2]);
          console.groupEnd();
          console.groupCollapsed("   removes", change[1]);
          console.table(change[3]);
          console.groupEnd();
        }
      }
    });
  }

  function isUndefined(val) {
    return val === undefined;
  }

  function getDataStats(data) {
    var totalAdds = 0;
    var totalRemoves = 0;
    var malformedDiffs = [];
    var badValues = [];
    data.changes.forEach(function(change) {
      totalAdds += change[2].length;
      totalRemoves += change[3].length;
      var hasMalformedDiffs = false;
      var hasBadValues = false;
      change[2].forEach(function(diff) {
        hasMalformedDiffs = hasMalformedDiffs || (diff.length !== change[1].length);
        hasBadValues = hasBadValues || diff.some(isUndefined);
      });

      change[3].forEach(function(diff) {
        hasMalformedDiffs = hasMalformedDiffs || (diff.length !== change[1].length);
        hasBadValues = hasBadValues || diff.some(isUndefined);
      });
      if (hasMalformedDiffs) {
        malformedDiffs.push(change[0]);
      }
      if (hasBadValues) {
        badValues.push(change[0]);
      }
    });

    return { adds: totalAdds, removes: totalRemoves, malformedDiffs: malformedDiffs, badValues: badValues };
  }

  var server = { connected: false, queue: [], initialized: false, lastSent: [], ws: null, dead: false };
  function connectToServer() {
    var queue = server.queue;
    var wsAddress = "ws://localhost:2794";
    if(window.location.protocol !== "file:") {
      wsAddress = `ws://${window.location.hostname}:2794`;
    }
    var ws = new WebSocket(wsAddress, []);
    server.ws = ws;

    ws.onerror = ws.onclose = function(error) {
      server.dead = true;
      var error_banner = document.createElement("div");
      error_banner.innerHTML = `Error: Eve Server is Dead! ${error ? `Reason: ${error}` : ""}`;
      error_banner.setAttribute("class","dead-server-banner");
      document.body.appendChild(error_banner);
    }
    
    ws.onopen = function() {
      server.connected = true;
      for (var i = 0, len = queue.length; i < len; i++) {
        sendToServer(queue[i], false);
      }
    }

    ws.onmessage = function(e) {
      var start = now();
      var time:number;
      var data = JSON.parse(e.data);
      var time = now() - start;
      if (time > 5) {
        console.log("slow parse (> 5ms):", time);
      }

      var changes = [];
      for(var change of data.changes) {
        var [view, fields, inserts, removes] = change;
        if (!api.code.hasTag(view, "editor")) {
          changes.push(change);
        }
      }

      if (DEBUG.RECEIVE) {
        var stats = getDataStats({changes: changes});
        if (stats.adds || stats.removes) {
          var header = "[client:received][+" + stats.adds + "/-" + stats.removes + "]";
          console.groupCollapsed(pad(header, formatTime(null), undefined, undefined));
          if (stats.malformedDiffs.length) {
            console.warn("The following views have malformed diffs:", stats.malformedDiffs);
          }
          if (stats.badValues.length) {
            console.warn("The following views have bad values:", stats.badValues);
          }
          writeDataToConsole({ changes: changes }, DEBUG.RECEIVE);
          console.groupEnd();
        }
      }

      var start = now();

      ixer.handleMapDiffs(changes);

      if (initializing) {
        var eventId = (ixer.facts("client event") || []).length;
        uiEditorRenderer.setEventId(eventId);
        uiEditorRenderer.setSessionId(data.session);
        var neueDiffs = api.diff.computePrimitives();

        ixer.handleDiffs(neueDiffs);
        for(var initFunc of afterInitFuncs) {
          initFunc();
        }
      }

      var time = now() - start;
      if (time > 5) {
        console.log("slow handleDiffs (> 5ms):", time);
      }

      dispatcher.render();

      // Get the user ID from a cookie
      var name = "userid" + "=";
      var cookie = document.cookie.split(';');
      var userid = "";
      if (cookie[0].indexOf(name) == 0)
        userid = cookie[0].substring(name.length, cookie[0].length);

      // Check if the user ID is found. If not, redirect the user to log in.
      if (userid == "") {
        // TODO Handle a user who isn't logged in.
        console.log("Session has not been authenticated.");
      } else {
        var eveusers = api.ixer.index("eveusers id to username");
        var username = eveusers[userid];
        if (typeof username == 'undefined') {
          // TODO Handle a user who is not in the eveuser table
          console.log("Session cookie does not identify an eveuser.");
        } else {
          // TODO Handle a user who is logged in
          console.log("You are logged in as " + username);
        }
      }
    };

    ws.onopen = function() {
      server.connected = true;
      for (var i = 0, len = queue.length; i < len; i++) {
        sendToServer(queue[i], false);
      }
    }
  }

  export function sendToServer(message, formatted?) {
    if (!server.connected) {
      console.log("not connected");
      server.queue.push(message);
    } else {
      // console.log("sending", message);
      if (!formatted) {
        message = toMapDiffs(message);
      }
      var payload = { changes: [] };
      var specialPayload = { changes: [] };

      for (var ix = 0; ix < message.changes.length; ix++) {
        var table = message.changes[ix][0];
        if (api.code.hasTag(table, "code")) {
          specialPayload.changes.push(message.changes[ix]);
        } else {
          payload.changes.push(message.changes[ix]);
        }
      }

      if (DEBUG.SEND) {
        var stats = getDataStats(payload);
        var specialStats = getDataStats(specialPayload);
        if (stats.adds || stats.removes || specialStats.adds || specialStats.removes) {
          var header = "[client:sent][+" + (stats.adds + specialStats.adds) + "/-" + (stats.removes + specialStats.removes) + "]";
          console.groupCollapsed(pad(header, formatTime(undefined), undefined, undefined));

          if (specialStats.adds || specialStats.removes) {
            var header = "[special][+" + specialStats.adds + "/-" + specialStats.removes + "]";
            console.group(header);
            if (specialStats.malformedDiffs.length) {
              console.warn("The following views have malformed diffs:", specialStats.malformedDiffs);
            }
            if (stats.badValues.length) {
              console.warn("The following views have bad values:", stats.badValues);
            }
            writeDataToConsole(specialPayload, DEBUG.SEND);
            console.groupEnd();
          }
          if (stats.adds || stats.removes) {
            var header = "[normal][+" + stats.adds + "/-" + stats.removes + "]";
            console.group(header);
            if (stats.malformedDiffs.length) {
              console.warn("The following views have malformed diffs:", stats.malformedDiffs);
            }
            if (stats.badValues.length) {
              console.warn("The following views have bad values:", stats.badValues);
            }
            writeDataToConsole(payload, DEBUG.SEND);
            console.groupEnd();
          }
          console.groupEnd();
        }
      }

      if (specialPayload.changes.length) {
        server.ws.send(CBOR.encode(specialPayload));
      }
      if (payload.changes.length) {
        server.ws.send(CBOR.encode(payload));
      }
    }
  }

  export function toMapDiffs(diffs) {
    // Deduplicate diffs prior to sending with last write wins.
    var deduped = [];
    outer: for(var ix = diffs.length - 1; ix >= 0; ix--) {
      var diff = diffs[ix];
      for(var needleIx = deduped.length - 1; needleIx >= 0; needleIx--) {
        if(api.arraysIdentical(diff[2], deduped[needleIx][2]) && diff[0] === deduped[needleIx][0]) {
          continue outer;
        }
      }
      deduped.push(diff);
    }
    diffs = deduped;

    var final = { field: null };
    for (var i = 0, len = diffs.length; i < len; i++) {
      var cur = diffs[i];
      var table = cur[0];
      var action = cur[1];
      var fact = cur[2];
      if (!final[table]) {
        final[table] = { inserted: [], removed: [] };
      }
      final[table][action].push(fact);
    }

    var neueFields = {};

    for (var fieldIx = 0; final.field && fieldIx < final.field.inserted.length; fieldIx++) {
      // @FIXME: These must be inserted in order to work.
      // @FIXME: Does not account for removed fields, only appended fields.
      var field = final.field.inserted[fieldIx];
      var fieldViewId = field[0];
      var fieldId = field[1];
      if (!neueFields[fieldViewId]) { neueFields[fieldViewId] = (ixer.index("view to fields")[fieldViewId] || []).slice(); }
      neueFields[fieldViewId].push(fieldId);
    }

    var changes = [];
    for (var table in final) {
      if(!final[table]) continue;
      var fieldIds = api.code.sortedViewFields(table) || [];
      fieldIds = fieldIds.concat(neueFields[table] || []);

      changes.push([table, fieldIds, final[table].inserted, final[table].removed]);
    }
    return { changes: changes };
  }

  var afterInitFuncs: Function[] = [];
  export function afterInit(func) {
    afterInitFuncs.push(func);
  }

  document.addEventListener("DOMContentLoaded", function() {
    connectToServer();
  });

}
