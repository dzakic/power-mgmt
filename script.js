"use strict";

var powerApp = angular.module('powerApp', ['ngRoute']);

powerApp.config(function($routeProvider) {
    $routeProvider
        .when('/', {
            templateUrl: 'pages/home.html',
            controller: 'mainController'
        })
        .when('/about', {
            templateUrl: 'pages/about.html',
            controller: 'aboutController'
        })
});

powerApp.controller('mainController', function($scope) {

    // Configurable defaults:
    $scope.PS_VOLTAGE = 48; // default V
    $scope.PS_MAXW = 300; // default W
    $scope.CABLE_LEN = 300; // default m

    // Operational Constants
    $scope.MAX_KIDS = 2;
    $scope.CABLE_OHM = 12.3;
    $scope.NS_POWER = 14.7;
    $scope.IPOE_MAXW = 15;
    $scope.NS_VOLTAGE_MIN = 20; // minimum supported voltage on NS
    $scope.EPSILON = 1E-6;

    class Topology {
        constructor() {
            this.nodes = [];
        }
        get voltage() {
            return this.nodes.length > 0 ? this.nodes[0].voltage : 0;
        }
        addNode(name, type, parent) {
            var node = new Node(name, type);
            node.id = this.nodes.length;
            node.name = name ? name : node.type.toUpperCase() + "-" + node.id;;
            node.topology = this;
            if (parent) {
                parent.kids.push(node);
                node.parent = parent;
                node.level = parent.level + 1;
            }
            node.cableLenTotal = node.getCableLenTotal();
            var thisIndex = this.nodes.indexOf(parent);
            this.nodes.splice(thisIndex + 1, 0, node);
            return node;
        }

        tick() {
            this.nodes.forEach(node => node.tick());
        }

        save() {
            // TODO: Need .clone()
            return this.nodes;
        }

        restore(snapshot) {
            this.nodes = snapshot;
        }

    }

    class Node {
        constructor(name, type) {
            this.type = type ? type : 'ns';
            this.kids = [];
            this.poes = [ { Pself: 0}, { Pself: 0 } ];
            this.level = 0;
            if (this.type == 'ns') {
                this.cableLen = $scope.CABLE_LEN;
                this.PselfReq = $scope.NS_POWER;
            } else if (this.type == 'ps') {
                this.cableLen = 0;
                this.PselfReq = 0;
                this.voltage = $scope.PS_VOLTAGE;
                this.IparentMax = $scope.PS_MAXW / this.voltage;
            }
            // RT
            this.Iself = 0;
            this.Itotal = 0;
        }

        addChild(name, type) {
            this.topology.addNode(name, type, this);
        }

        delete() {
            var kidIndex = this.parent.kids.indexOf(this);
            this.parent.kids.splice(kidIndex, 1);
        }

        getIpoes() {
            return this.poes.reduce((sum, poe) => sum + poe.Iself || 0, 0);
        }

        getPpoesTotal() {
            return this.poes.reduce((sum, poe) => sum + poe.Pself, 0);
        }

        getIpoesMax() {
            return this.poes.reduce((sum, poe) => sum + poe.IselfMax || 0, 0);
        }

        getIkids() {
            return this.kids.reduce((sum, kid) => sum + kid.Itotal, 0);
        }

        getIkidsMax() {
            return this.kids.reduce((sum, kid) => sum + kid.ItotalMax, 0);
        }

        getCableLenTotal() {
            var parentCableLen = this.parent ? this.parent.cableLen : 0;
            return this.cableLen + parentCableLen;
        }


        get cableOhm() {
            return $scope.CABLE_OHM * this.cableLen / 1000;
        }

        get cableOhmTotal() {
            return $scope.CABLE_OHM * this.cableLenTotal / 1000;
        }

        get cableVdrop() {
            return this.cableOhm * this.Itotal;
        }

        get cableLoss() {
            return this.cableOhm * this.Itotal * this.Itotal;
        }

        get cableLossMax() {
            return this.cableOhm * this.ItotalMax * this.ItotalMax;
        }

        tick() {
            if (this.parent) {
                this.voltage = Math.max(0, this.parent.voltage - this.cableVdrop);
            }

            // Let PoE ports draw what is needed for current voltage
            this.poes.forEach(poe => poe.Iself = poe.Pself / this.voltage);

            this.Ikids = this.getIkids();
            this.Ipoes = this.getIpoes();
            this.Itotal = this.Iself + this.Ipoes + this.Ikids;

            // Simulate current node values
            var IselfReq = this.voltage == 0 ? 0 : this.PselfReq / this.voltage;
            // Local current has inertia. Get closer to desired by 20%
            this.Iself = this.Iself + (IselfReq - this.Iself) * 0.2;
            this.Pself = this.Iself * this.voltage;

            // Vmin is a worst case scenario for local voltage.
            // If this node was to use all of its allocated current, what will the voltage be?
            // Work out the voltage from the topology top and account for cable distance from the top
            var VparentMin = this.parent ? this.parent.Vmin : this.voltage;
            var ItargetMax = this.IparentMax;
            if (this.type != 'ps') {
                if (this.kids.some(kid => kid.ItotalMax < kid.IparentMax + $scope.EPSILON)) {
                    // At least one kid cannot use all reserved power. 
                    // We are over-budgeting. We can tryreleasing some
                    // of the reserved IparentMax hoping for less Vdrop
                    // and releasing more current and power downstream.
                    ItargetMax = this.IselfMax + this.IpoesMax + this.getIkidsMax();
                    //ItargetMax = (ItargetMax + this.IparentMax) / 2;
                    ItargetMax = this.ItotalMax + (ItargetMax - this.ItotalMax) * 0.1;
                }
            }
            this.ItotalMax = Math.max(ItargetMax, this.Itotal);
            this.Vmin = Math.min(this.voltage, VparentMin - this.cableOhm * this.ItotalMax);
            if (this.Vmin < $scope.NS_VOLTAGE_MIN) {
                // this.Vmin = $scope.NS_VOLTAGE_MIN;
                this.ItotalMax = (VparentMin - $scope.NS_VOLTAGE_MIN) / this.cableOhm;
            }

            // Available I before brownout:
            this.Pmax = this.Vmin * this.ItotalMax;
            this.IselfMax = this.PselfReq / this.Vmin;

            // Distribute what we believe is safe (worst case)
            this.poes.forEach(poe => poe.IselfMax = poe.Pself / this.Vmin);
            this.IpoesMax = this.getIpoesMax();
            this.Idist = Math.max(0, this.ItotalMax - this.IselfMax - this.IpoesMax);
            this.Pdist = this.Idist * this.Vmin;

            if (this.kids.some(kid => kid.Itotal === 0)) {
                // If we don't know kids' consumption, distribute evenly
                var IspareKid = this.Idist / this.kids.length;
                this.kids.forEach(kid => kid.IparentMax = IspareKid);
            } else {
                // For known consumption, distribute proportionally to balance uneven tree
                var quota = this.Idist / this.getIkids();
                this.kids.forEach(kid => kid.IparentMax = kid.Itotal * quota);
            }

            this.IavailPoes = this.ItotalMax - this.IselfMax - this.getIkidsMax();
            this.PpoesMax = this.IavailPoes * this.Vmin;
            this.PpoesAvail = this.PpoesMax - this.getPpoesTotal();
            
            this.Ptotal = this.Itotal * this.voltage;

        }
    }

    var topology = new Topology();
    var ups = topology.addNode('UPS', 'ps');
    ups.addChild('My NS60');

    $scope.topology = topology;

    $scope.editCableLength = function(node) {
        var value = prompt("Cable Length", node.cableLen);
        if (value)
            node.cableLen = Number(value);
    };

    $scope.editPoE = function(poe) {
        var value = prompt("POE Power:", poe.Pself);
        if (value)
            poe.Pself = Number(value);
    };

    $scope.editVoltage = function(node) {
        var value = prompt("Voltage", node.voltage);
        if (value)
            node.voltage = Number(value);
    };

    $scope.removeNode = function(index) {
        var node = topology.nodes[index];
        node.delete();
        topology.nodes.splice(index, 1);
    }

    // Timer functions

    var stopTimer = function() {
        window.clearInterval($scope.timer);
        $scope.timer = null;
    };

    var startTimer = function() {
        if ($scope.timer) stopTimer();
        $scope.timer = window.setInterval(function() {
            topology.tick();
            $scope.$apply();
        }, $scope.playSpeed);
    };

    var changeSpeed = function(newSpeed) {
        $scope.playSpeed = newSpeed($scope.playSpeed);
        startTimer();
    };

    $scope.speedUp = function() {
        changeSpeed(speed => speed / 2);
    };

    $scope.slowDown = function() {
        changeSpeed(speed => speed * 2);
    };

    $scope.play = function() {
        $scope.playSpeed = 125;
        startTimer();
    }

    $scope.stop = function() {
        stopTimer();
    }

    $scope.save = function() {
        $scope.snapshot = topology.save();
    }

    $scope.restore = function() {
        topology.restore($scope.snapshot);
    }

    $scope.play();


});

powerApp.controller('aboutController', function($scope) {
    $scope.message = 'I am an about page.';
});

/*

    IparentMax - Set by the Parent. Informs the kid how much current is 
                    safe to use without checking with parent beforehand. 
                    Parent calculated, everyone above will guaranteed be 
                    fine as long as 'you' don't draw more than this. Base 
                    all your power budgets assuming this worst case.

    ItotalMax - The node figured this is the max we can use locally. This
                    includes IselfMax + sum(kids IparentMax) + local POE

    Vmin - The lowest local voltage we are prepared to deal with. This is
                    the parent Vmin minus the maximum cable V frop if we 
                    are to draw the maximum current. Worst case.

    IselfMax - Maximum current that will be drawn by the node locally. This
                    is the current required to supply 14.7W on Vmin.
*/