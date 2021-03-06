// ==UserScript==
// @name         agar-mini-map
// @namespace    http://github.com/dimotsai/
// @version      0.48.1
// @description  This script will show a mini map and your location on agar.io
// @author       dimotsai
// @license      MIT
// @match        http://agar.io/*
// @require      http://cdn.jsdelivr.net/msgpack/1.05/msgpack.js
// @grant        none
// @run-at       document-body
// ==/UserScript==

window.msgpack = this.msgpack;

(function() {
    var _WebSocket = window._WebSocket = window.WebSocket;
    var $ = window.jQuery;
    var msgpack = window.msgpack;
    var options = {
        enableMultiCells: true,
        enablePosition: true,
        enableAxes: false,
        enableCross: true,
        enableUniqueCellColor: true
    };

    var DEFAULT_SIZE = 14000;
    var DEFAULT_SIZE_2 = DEFAULT_SIZE / 2;

    // game states
    var agar_server = null;
    var map_server = null;
    var player_name = [];
    var players = [];
    // !note: these default values have to be set in miniMapInit
    var id_players = [];
    var cells = {};
    var current_cell_ids = [];
    var start_x = -DEFAULT_SIZE_2,
        start_y = -DEFAULT_SIZE_2,
        end_x = DEFAULT_SIZE_2,
        end_y = DEFAULT_SIZE_2,
        length_x = 14000,
        length_y = 14000;
    var edge_top = null,
        edge_right = null,
        edge_bottom = null,
        edge_left = null;
    var offset_x = null,
        offset_y = null,
        map_size_x = 14000,
        map_size_y = 14000;
    var render_timer = null;
    var last_server = null;

    function miniMapSendRawData(data) {
        if (map_server !== null && map_server.readyState === window._WebSocket.OPEN) {
            var array = new Uint8Array(data);
            map_server.send(array.buffer);
        }
    }

    function miniMapConnectToServer(address, onOpen, onClose) {
        try {
            var ws = new window._WebSocket(address);
            document.cookie = "agar-mini-map-server=" + address;
        } catch (ex) {
            onClose();
            console.error(ex);
            return false;
        }
        ws.binaryType = "arraybuffer";

        ws.onopen = function() {
            onOpen();
            console.log(address + ' connected');
        }

        ws.onmessage = function(event) {
            var buffer = new Uint8Array(event.data);
            var packet = msgpack.unpack(buffer);
            switch(packet.type) {
                case 128:
                    for (var i=0; i < packet.data.addition.length; ++i) {
                        var cell = packet.data.addition[i];
                        if (! miniMapIsRegisteredToken(cell.id))
                        {
                            miniMapRegisterToken(
                                cell.id,
                                miniMapCreateToken(cell.id, cell.color)
                            );
                        }

                        miniMapUpdateToken(cell.id, cell.x, cell.y, cell.size);
                    }

                    for (var i=0; i < packet.data.deletion.length; ++i) {
                        var id = packet.data.deletion[i];
                        miniMapUnregisterToken(id);
                    }
                    break;
                case 129:
                    players = packet.data;
                    for (var p in players) {
                        var player = players[p];
                        var ids = player.ids;
                        for (var i in ids) {
                            id_players[ids[i]] = player.no;
                        }
                    }
                    mini_map_party.trigger('update-list');
                    break;
                case 130:
                    if (agar_server != packet.data.url) {
                        var region_name = $('#region > option[value="' + packet.data.region + '"]').text();
                        var gamemode_name = $('#gamemode > option[value="' + packet.data.gamemode + '"]').text();
                        var title = 'Agar Server Mismatched';
                        var content = ('You are now at: <strong>' + agar_server
                            + '</strong><br>Your team members are all at: <strong>' + packet.data.url + ', ' + region_name + ':' + gamemode_name + packet.data.party
                            + '</strong>.<br>The minimap server has disconnected automatically.');

                        $('#mini-map-connect-btn').popover('destroy').popover({
                            animation: false,
                            placement: 'top',
                            title: title,
                            content: content,
                            container: document.body,
                            html: true
                        }).popover('show');
                    } else {
                        $('#mini-map-content-btn').popover('hide');
                    }
                    break;
            }
        }

        ws.onerror = function() {
            onClose();
            console.error('failed to connect to map server');
        }

        ws.onclose = function() {
            onClose();
            map_server = null;
            console.log('map server disconnected');
        }

        map_server = ws;
    }

    function getCanvasCoordX(canvas, coord_x) {
        return (offset_x !== null && offset_y !== null) // full map mode
            ? ((coord_x - offset_x) / map_size_x + 0.5) * canvas.width
            : ((coord_x - start_x) / length_x) * canvas.width;
    }

    function getCanvasCoordY(canvas, coord_y) {
        return (offset_x !== null && offset_y !== null) // full map mode
            ? ((coord_y - offset_y) / map_size_y + 0.5) * canvas.height
            : ((coord_y - start_y) / length_y) * canvas.height;
    }

    function miniMapRender() {
        var fullmode = offset_x !== null && offset_y !== null;
        var canvas = window.mini_map;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // if (options.enableAxes) miniMapDrawMiddleCross();

        for (var id in window.mini_map_tokens) {
            var token = window.mini_map_tokens[id];
            var x = getCanvasCoordX(canvas, token.x), 
                y = getCanvasCoordY(canvas, token.y);
            var size = token.size / (fullmode ? map_size_x : length_x) * canvas.width;
            var myColor = null;
            var isMyCell = false;

            if (options.enableUniqueCellColor) {
                if (window.darkThemeCheckBox.checked) {
                    myColor = "white";
                } else {
                    myColor = "black";
                }
            } else {
                myColor = token.color;
            }

            if (options.enableCross && -1 != current_cell_ids.indexOf(token.id)) {
                miniMapDrawCross(x, y, myColor);
                isMyCell = true;
            }

            if (id_players[id] !== undefined) {
                // Draw you party member's crosshair
                if (options.enableCross && !isMyCell) {
                    miniMapDrawCross(x, y, token.color);
                }

                ctx.font = size * 2 + 'px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'white';
                ctx.fillText(id_players[id] + 1, x, y);
            }

            ctx.beginPath();
            ctx.arc(
                x,
                y,
                size,
                0,
                2 * Math.PI,
                false
            );
            ctx.closePath();
            if (isMyCell) {
                ctx.fillStyle = myColor;
            } else {
                ctx.fillStyle = token.color;
            }
            ctx.strokeStyle = ctx.fillStyle;
            ctx.fill();

            if (fullmode) {
                ctx.strokeStyle = "red";
                ctx.lineWidth = 1;
                var x0 = getCanvasCoordX(canvas, start_x), 
                    y0 = getCanvasCoordY(canvas, start_y),
                    x1 = getCanvasCoordX(canvas, end_x), 
                    y1 = getCanvasCoordY(canvas, end_y);
                ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
            }
        };
    }

    function miniMapDrawCross(x, y, color) {
        var canvas = window.mini_map;
        var ctx = canvas.getContext('2d');
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.closePath();
        ctx.strokeStyle = color || '#FFFFFF';
        ctx.stroke();
    }

    function miniMapDrawMiddleCross() {
        var canvas = window.mini_map;
        var ctx = canvas.getContext('2d');
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height/2);
        ctx.lineTo(canvas.width, canvas.height/2);
        ctx.moveTo(canvas.width/2, 0);
        ctx.lineTo(canvas.width/2, canvas.height);
        ctx.closePath();
        ctx.strokeStyle = '#000000';
        ctx.stroke();
    }

    function miniMapCreateToken(id, color) {
        var mini_map_token = {
            id: id,
            color: color,
            x: 0,
            y: 0,
            size: 0
        };
        return mini_map_token;
    }

    function miniMapRegisterToken(id, token) {
        if (window.mini_map_tokens[id] === undefined) {
            // window.mini_map.append(token);
            window.mini_map_tokens[id] = token;
        }
    }

    function miniMapUnregisterToken(id) {
        if (window.mini_map_tokens[id] !== undefined) {
            // window.mini_map_tokens[id].detach();
            delete window.mini_map_tokens[id];
        }
    }

    function miniMapIsRegisteredToken(id) {
        return window.mini_map_tokens[id] !== undefined;
    }

    function miniMapUpdateToken(id, x, y, size) {
        if (window.mini_map_tokens[id] !== undefined) {

            window.mini_map_tokens[id].x = x;
            window.mini_map_tokens[id].y = y;
            window.mini_map_tokens[id].size = size;

            return true;
        } else {
            return false;
        }
    }

    function miniMapUpdatePos(x, y) {
        window.mini_map_pos.text('x: ' + x.toFixed(0) + ', y: ' + y.toFixed(0));
    }

    function miniMapReset() {
        cells = {};
        window.mini_map_tokens = [];
    }

    function destroyCells(cell_collection) {
        for (var idx in cell_collection) {
            if(cell_collection[idx]) cell_collection[idx].destroy();
        }
    }

    function miniMapInit() {
        destroyCells(cells);

        window.mini_map_tokens = [];

        cells = {};
        current_cell_ids = [];
        start_x = -DEFAULT_SIZE_2;
        start_y = -DEFAULT_SIZE_2;
        end_x = DEFAULT_SIZE_2;
        end_y = DEFAULT_SIZE_2;
        length_x = 14000;
        length_y = 14000;
        offset_x = null;
        offset_y = null;
        map_size_x = 14000,
        map_size_y = 14000;
        edge_top = null,
        edge_right = null,
        edge_bottom = null,
        edge_left = null;
        map_size_x = DEFAULT_SIZE;
        map_size_y = DEFAULT_SIZE;

        // get last used map server address from cookie if existent
        var cookies = document.cookie.replace(/ /g,'').split(";");
        for (var i=0; i<cookies.length; i++){
            var c_tuple= cookies[i].split("=");
            if (c_tuple[0] == "agar-mini-map-server"){
                last_server = c_tuple[1];
            }
        }
        if (last_server === null) {
            last_server = "ws://127.0.0.1:34343";
        }

        // minimap dom
        if ($('#mini-map-wrapper').length === 0) {
            var wrapper = $('<div>').attr('id', 'mini-map-wrapper').css({
                position: 'fixed',
                bottom: 10,
                right: 10,
                width: 300,
                height: 300,
                background: 'rgba(128, 128, 128, 0.58)'
            });

            var mini_map = $('<canvas>').attr({
                id: 'mini-map',
                width: 300,
                height: 300
            }).css({
                width: '100%',
                height: '100%',
                position: 'relative'
            });

            wrapper.append(mini_map).appendTo(document.body);

            window.mini_map = mini_map[0];
        }

        // minimap renderer
        if (render_timer === null)
            render_timer = setInterval(miniMapRender, 1000 / 30);

        // minimap location
        if ($('#mini-map-pos').length === 0) {
            window.mini_map_pos = $('<div>').attr('id', 'mini-map-pos').css({
                bottom: 10,
                right: 10,
                color: 'white',
                fontSize: 15,
                fontWeight: 800,
                position: 'fixed'
            }).appendTo(document.body);
        }

        // dark theme checkbox
        window.darkThemeCheckBox = $('[data-itr=option_dark_theme]').parent().children('input')[0];

        // minimap options
        if ($('#mini-map-options').length === 0) {
            window.mini_map_options = $('<div>').attr('id', 'mini-map-options').css({
                bottom: 315,
                right: 10,
                color: '#666',
                fontSize: 14,
                position: 'fixed',
                fontWeight: 400,
                zIndex: 1000
            }).appendTo(document.body);

            var container = $('<div>')
                .css({
                    background: 'rgba(200, 200, 200, 0.58)',
                    padding: 5,
                    borderRadius: 5
                })
                .hide();

            for (var name in options) {

                var label = $('<label>').css({
                    display: 'block'
                });

                var checkbox = $('<input>').attr({
                    type: 'checkbox'
                }).prop({
                    checked: options[name]
                });

                label.append(checkbox);
                label.append(' ' + camel2cap(name));

                checkbox.click(function(options, name) { return function(evt) {
                    options[name] = evt.target.checked;
                    console.log(name, evt.target.checked);
                }}(options, name));

                label.appendTo(container);
            }

            container.appendTo(window.mini_map_options);
            var form = $('<div>')
                .addClass('form-inline')
                .css({
                    opacity: 0.7,
                    marginTop: 2
                })
                .appendTo(window.mini_map_options);

            var form_group = $('<div>')
                .addClass('form-group')
                .appendTo(form);

            var setting_btn = $('<button>')
                .addClass('btn')
                .css({
                    float: 'right',
                    fontWeight: 800,
                    marginLeft: 2
                })
                .on('click', function() {
                    container.toggle();
                    setting_btn.blur();
                    return false;
                })
                .append($('<i>').addClass('glyphicon glyphicon-cog'))
                .appendTo(form_group);

            var help_btn = $('<button>')
                .addClass('btn')
                .text('?')
                .on('click', function(e) {
                    window.open('https://github.com/dimotsai/agar-mini-map/#minimap-server');
                    help_btn.blur();
                    return false;
                })
                .appendTo(form_group);

            var addressInput = $('<input>')
                .css({
                    marginLeft: 2
                })
                .attr('placeholder', 'ws://127.0.0.1:34343')
                .attr('type', 'text')
                .addClass('form-control')
                .val(last_server)
                .appendTo(form_group);

            var connect = function (evt) {
                var address = addressInput.val();

                connectBtn.popover('destroy');
                connectBtn.text('Disconnect');
                miniMapConnectToServer(address, function onOpen() {
                    miniMapSendRawData(msgpack.pack({
                        type: 0,
                        data: player_name
                    }));
                    for (var i in current_cell_ids) {
                        miniMapSendRawData(msgpack.pack({
                            type: 32,
                            data: current_cell_ids[i]
                        }));
                    }
                    miniMapSendRawData(msgpack.pack({
                        type: 100,
                        data: {url: agar_server, region: $('#region').val(), gamemode: $('#gamemode').val(), party: location.hash}
                    }));
                    window.mini_map_party.show();
                }, function onClose() {
                    players = [];
                    id_players = [];
                    window.mini_map_party.hide();
                    disconnect();
                });

                connectBtn.off('click');
                connectBtn.on('click', disconnect);

                miniMapReset();

                connectBtn.blur();
            };

            var disconnect = function() {
                connectBtn.text('Connect');
                connectBtn.off('click');
                connectBtn.on('click', connect);
                connectBtn.blur();
                if (map_server)
                    map_server.close();

                miniMapReset();
            };

            var connectBtn = $('<button>')
                .attr('id', 'mini-map-connect-btn')
                .css({
                     marginLeft: 2
                })
                .text('Connect')
                .click(connect)
                .addClass('btn')
                .appendTo(form_group);
        }

        // minimap party
        if ($('#mini-map-party').length === 0) {
            var mini_map_party = window.mini_map_party = $('<div>')
                .css({
                    top: 50,
                    left: 10,
                    width: 200,
                    color: '#FFF',
                    fontSize: 20,
                    position: 'fixed',
                    fontWeight: 600,
                    background: 'rgba(128, 128, 128, 0.58)',
                    textAlign: 'center',
                    padding: 10
                })
                .attr('id', 'mini-map-party')
                .appendTo(window.document.body)
                .append(
                    $('<h3>').css({
                        margin: 0,
                        padding: 0
                    }).text('Party')
                );

            var mini_map_party_list = $('<ol>')
                .attr('id', 'mini-map-party-list')
                .css({
                    listStyle: 'none',
                    padding: 0,
                    margin: 0
                })
                .appendTo(mini_map_party);

            mini_map_party.on('update-list', function(e) {
                mini_map_party_list.empty();

                for (var p in players) {
                    var player = players[p];
                    var name = String.fromCharCode.apply(null, player.name);
                    name = (name == '' ? 'anonymous' : name);
                    $('<li>')
                        .text(player.no + 1 + '. ' + name)
                        .appendTo(mini_map_party_list);
                }
            });

            mini_map_party.hide();
        }
    }

    // cell constructor
    function Cell(id, x, y, size, color, name) {
        cells[id] = this;
        this.id = id;
        this.ox = this.x = x;
        this.oy = this.y = y;
        this.oSize = this.size = size;
        this.color = color;
        this.points = [];
        this.pointsAcc = [];
        this.setName(name);
    }

    Cell.prototype = {
        id: 0,
        points: null,
        pointsAcc: null,
        name: null,
        nameCache: null,
        sizeCache: null,
        x: 0,
        y: 0,
        size: 0,
        ox: 0,
        oy: 0,
        oSize: 0,
        nx: 0,
        ny: 0,
        nSize: 0,
        updateTime: 0,
        updateCode: 0,
        drawTime: 0,
        destroyed: false,
        isVirus: false,
        isAgitated: false,
        wasSimpleDrawing: true,

        destroy: function() {
            delete cells[this.id];
            id = current_cell_ids.indexOf(this.id);
            -1 != id && current_cell_ids.splice(id, 1);
            this.destroyed = true;
            if (map_server === null || map_server.readyState !== window._WebSocket.OPEN) {
                miniMapUnregisterToken(this.id);
            }
        },
        setName: function(name) {
            this.name = name;
        },
        updatePos: function() {
            if (map_server === null || map_server.readyState !== window._WebSocket.OPEN) {
                if (options.enableMultiCells || -1 != current_cell_ids.indexOf(this.id)) {
                    if (! miniMapIsRegisteredToken(this.id))
                    {
                        miniMapRegisterToken(
                            this.id,
                            miniMapCreateToken(this.id, this.color)
                        );
                    }

                    miniMapUpdateToken(this.id, this.nx, this.ny, this.nSize);
                }
            }

            if (options.enablePosition && -1 != current_cell_ids.indexOf(this.id)) {
                window.mini_map_pos.show();
                miniMapUpdatePos(this.nx, this.ny);
            } else {
                window.mini_map_pos.hide();
            }

        }
    };

    String.prototype.capitalize = function() {
        return this.charAt(0).toUpperCase() + this.slice(1);
    };

    function camel2cap(str) {
        return str.replace(/([A-Z])/g, function(s){return ' ' + s.toLowerCase();}).capitalize();
    };

    // create a linked property from slave object
    // whenever master[prop] update, slave[prop] update
    function refer(master, slave, prop) {
        Object.defineProperty(master, prop, {
            get: function(){
                return slave[prop];
            },
            set: function(val) {
                slave[prop] = val;
            },
            enumerable: true,
            configurable: true
        });
    };

    // extract a websocket packet which contains the information of cells
    function extractCellPacket(data, offset) {
        ////
        var dataToSend = {
            destroyQueue : [],
            nodes : [],
            nonVisibleNodes : []
        };
        ////

        var I = +new Date;
        var qa = false;
        var b = Math.random(), c = offset;
        var size = data.getUint16(c, true);
        c = c + 2;

        function getName() {
            for (var string = ""; ; ) {
                var ch = data.getUint16(c, true);
                c += 2;
                if (0 == ch)
                    break;
                string += String.fromCharCode(ch)
            }
            return string;
        }

        function getSkin() {
            for (var string = ""; ; ) {
                var ch = data.getUint8(c++);
                if (0 == ch)
                    break;
                string += String.fromCharCode(ch)
            }
            return string;
        }

        // Nodes to be destroyed (killed)
        for (var e = 0; e < size; ++e) {
            var p = cells[data.getUint32(c, true)],
                f = cells[data.getUint32(c + 4, true)],
                c = c + 8;
            p && f && (
                f.destroy(),
                f.ox = f.x,
                f.oy = f.y,
                f.oSize = f.size,
                f.nx = p.x,
                f.ny = p.y,
                f.nSize = f.size,
                f.updateTime = I,
                dataToSend.destroyQueue.push(f.id));

        }

        // Nodes to be updated
        for (e = 0; ; ) {
            var d = data.getUint32(c, true);
            c += 4;
            if (0 == d) {
                break;
            }
            ++e;
            var p = data.getInt32(c, true),
                c = c + 4,
                f = data.getInt32(c, true),
                c = c + 4;
                g = data.getInt16(c, true);
                c = c + 2;
            for (var h = data.getUint8(c++), m = data.getUint8(c++), q = data.getUint8(c++), h = (h << 16 | m << 8 | q).toString(16); 6 > h.length; )
                h = "0" + h;

            var h = "#" + h,
                k = data.getUint8(c++),
                m = !!(k & 1),
                q = !!(k & 16);

            var skin = null;
            var name = null;

            k & 2 && (c += 4 + data.getUint32(c, true));
            k & 4 && (skin = getSkin());
            //k & 8 && (c += 16);

            name = getName();
            k = null;

            var updated = false;
            // if d in cells then modify it, otherwise create a new cell
            cells.hasOwnProperty(d)
                ? (k = cells[d],
                   k.updatePos(),
                   k.ox = k.x,
                   k.oy = k.y,
                   k.oSize = k.size,
                   k.color = h,
                   updated = true)
                : (k = new Cell(d, p, f, g, h, name),
                   k.pX = p,
                   k.pY = f);

            k.isVirus = m;
            k.isAgitated = q;
            k.nx = p;
            k.ny = f;
            k.nSize = g;
            k.updateCode = b;
            k.updateTime = I;
            skin && (k.skin = skin);
            name && k.setName(name);

            // ignore food creation
            if (updated) {
                dataToSend.nodes.push({
                    id: k.id,
                    x: k.nx,
                    y: k.ny,
                    size: k.nSize,
                    color: k.color
                });
            }
        }

        // Destroy queue + nonvisible nodes
        b = data.getUint32(c, true);
        c += 4;
        for (e = 0; e < b; e++) {
            d = data.getUint32(c, true);
            c += 4, k = cells[d];
            null != k && k.destroy();
            dataToSend.nonVisibleNodes.push(d);
        }

        var packet = {
            type: 16,
            data: dataToSend
        }

        miniMapSendRawData(msgpack.pack(packet));
    }

    // clean up cell array
    // ensures that old unreferenced cells are destroyed
    function clearOldCells() {
        var cells2delete = [];
        for (i in cells) {
            if (cells[i]) {
                var elapsedTimeInSec = ((+new Date) - cells[i].updateTime) / 1000;
                if (elapsedTimeInSec > 10) {
                    cells2delete.push(cells[i]);
                }
            }
        };
        destroyCells(cells2delete);
    }

    function detectEdge(edge, center, point) {
        return Math.abs(point - edge) < Math.abs(point - center);
    }

    // extract the type of packet and dispatch it to a corresponding extractor
    function extractPacket(event) {
        var c = 0;
        var data = new DataView(event.data);
        240 == data.getUint8(c) && (c += 5);
        var opcode = data.getUint8(c);
        c++;
        switch (opcode) {
            case 16: // cells data
                extractCellPacket(data, c);
                break;
            case 20: // cleanup ids
                current_cell_ids = [];
                break;
            case 32: // cell id belongs me
                var id = data.getUint32(c, true);

                if (current_cell_ids.indexOf(id) === -1)
                    current_cell_ids.push(id);

                miniMapSendRawData(msgpack.pack({
                    type: 32,
                    data: id
                }));
                break;
            case 64: // get borders
                start_x = data.getFloat64(c, !0), c += 8,
                start_y = data.getFloat64(c, !0), c += 8,
                end_x = data.getFloat64(c, !0), c += 8,
                end_y = data.getFloat64(c, !0), c += 8;
                center_x = (start_x + end_x) / 2,
                center_y = (start_y + end_y) / 2;
                length_x = Math.abs(start_x - end_x),
                length_y = Math.abs(start_y - end_y);

                if (edge_top === null || edge_left === null 
                        || edge_bottom === null || edge_right === null) {

                    // find greatest mass
                    var bigcell;
                    for (i in current_cell_ids) {
                        if(!bigcell || cells[current_cell_ids[i]].nSize > bigcell.nSize) {
                            bigcell = cells[current_cell_ids[i]];
                        }
                    }

                    // detect edges
                    if (bigcell) {
                        if (edge_top === null && detectEdge(start_y, center_y, bigcell.ny)) {
                            edge_top = start_y, console.log("edge_top = " + edge_top);
                            if (edge_bottom !== null) map_size_y = edge_bottom - edge_top; // Math.abs not needed yet
                        }
                        if (edge_right === null && detectEdge(end_x, center_x, bigcell.nx)) {
                            edge_right = end_x, console.log("edge_right = " + edge_right);
                            if (edge_left !== null) map_size_x = edge_right - edge_left; // Math.abs not needed yet
                        }
                        if (edge_bottom === null && detectEdge(end_y, center_y, bigcell.ny)) {
                            edge_bottom = end_y, console.log("edge_bottom = " + edge_bottom);
                            if (edge_top !== null) map_size_y = edge_bottom - edge_top; // Math.abs not needed yet
                        }
                        if (edge_left === null && detectEdge(start_x, center_x, bigcell.nx)) {
                            edge_left = start_x, console.log("edge_left = " + edge_left);
                            if (edge_right !== null) map_size_x = edge_right - edge_left; // Math.abs not needed yet
                        }
                        // console.log("edges: " + "top " + edge_top + ", right " + edge_right + ", bottom " + edge_bottom + ", left " + edge_left);
                    } else {
                        console.warn('no big cell');
                    }

                    if (edge_left !== null) {
                        offset_x = edge_left + map_size_x / 2;
                    } else if (edge_right !== null) {
                        offset_x = edge_right - map_size_x / 2;
                    }

                    if (edge_top !== null) {
                        offset_y = edge_top + map_size_y / 2;
                    } else if (edge_bottom !== null) {
                        offset_y = edge_bottom - map_size_y / 2;
                    }

                    // console.log("offset: " + offset_x + "x" + offset_y);
                }
        }
    };

    function extractSendPacket(data) {
        var view = new DataView(data);
        switch (view.getUint8(0, true)) {
            case 0:
                player_name = [];
                for (var i=1; i < data.byteLength; i+=2) {
                    player_name.push(view.getUint16(i, true));
                }

                miniMapSendRawData(msgpack.pack({
                    type: 0,
                    data: player_name
                }));
                break;
        }
    }

    // the injected point, overwriting the WebSocket constructor
    window.WebSocket = function(url, protocols) {
        console.log('Listen');

        if (protocols === undefined) {
            protocols = [];
        }

        var ws = new _WebSocket(url, protocols);

        refer(this, ws, 'binaryType');
        refer(this, ws, 'bufferedAmount');
        refer(this, ws, 'extensions');
        refer(this, ws, 'protocol');
        refer(this, ws, 'readyState');
        refer(this, ws, 'url');

        this.send = function(data){
            extractSendPacket(data);
            return ws.send.call(ws, data);
        };

        this.close = function(){
            return ws.close.call(ws);
        };

        this.onopen = function(event){};
        this.onclose = function(event){};
        this.onerror = function(event){};
        this.onmessage = function(event){};

        ws.onopen = function(event) {
            miniMapInit();

            var real_url = null;
            if (url.split("://")[0] == "wss") {
                real_url = agar_server;
            } else {
                real_url = url;
            }
            agar_server = real_url;

            miniMapSendRawData(msgpack.pack({
                type: 100,
                data: {url: real_url, region: $('#region').val(), gamemode: $('#gamemode').val(), party: location.hash}
            }));
            if (this.onopen)
                return this.onopen.call(ws, event);
        }.bind(this);

        ws.onmessage = function(event) {
            extractPacket(event);
            if (this.onmessage)
                return this.onmessage.call(ws, event);
        }.bind(this);

        ws.onclose = function(event) {
            if (this.onclose)
                return this.onclose.call(ws, event);
        }.bind(this);

        ws.onerror = function(event) {
            if (this.onerror)
                return this.onerror.call(ws, event);
        }.bind(this);
    };

    window.WebSocket.prototype = _WebSocket;

    $(window.document).ready(function() {
        miniMapInit();
        window.setInterval(clearOldCells, 1000);
    });

    $(window).load(function() {
        var main_canvas = document.getElementById('canvas');
        if (main_canvas && main_canvas.onmousemove) {
            document.onmousemove = main_canvas.onmousemove;
            main_canvas.onmousemove = null;
        }
    });
})();
