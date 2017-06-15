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

    // Operational Constants
    $scope.MAX_KIDS = 2;
    $scope.CABLE_OHM = 12.3;
    $scope.NS_POWER = 14.7;
    $scope.PS_VOLTAGE = 60; // default
    $scope.PS_MAXW = 200; // 
    $scope.IPOE_MAXW = 15;

    class Topology {
        constructor() {
            this.nodes = [];
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
            var thisIndex = this.nodes.indexOf(parent);
            this.nodes.splice(thisIndex + 1, 0, node);
            return node;
        }

        tick() {
            this.nodes.forEach(function(node) {
                node.tick();
            });
        }

    }

    class Node {
        constructor(name, type) {
            this.type = type ? type : 'ns';
            this.kids = [];
            this.PoEs = [];
            this.level = 0;
            if (this.type == 'ns') {
                this.cableLen = 200;
                this.Pself = $scope.NS_POWER;
            } else if (this.type == 'ps') {
                this.cableLen = 0;
                this.Pself = 0;
                this.voltage = $scope.PS_VOLTAGE;
                this.Imax = $scope.PS_MAXW / this.voltage;
            }
            // RT
            this.current = 0;
        }

        addChild(name, type) {
            this.topology.addNode(name, type, this);
        }

        delete() {
            var kidIndex = this.parent.kids.indexOf(this);
            this.parent.kids.splice(kidIndex, 1);
        }

        get Ptotal() {
            return this.instPower + this.Ppoes + this.Pkids;
        }

        get Ppoes() {
            return this.PoEs.reduce((sum, poe) => sum + poe.instPower, 0);
        }

        get Ipoes() {
            return this.PoEs.reduce((sum, poe) => sum + poe.current, 0);
        }

        get Pkids() {
            return this.kids.reduce((sum, kid) => sum + kid.instPower, 0)
        }

        get Ikids() {
            return this.kids.reduce((sum, kid) => sum + kid.current, 0);
        }

        get cableOhm() {
            return $scope.CABLE_OHM * this.cableLen / 1000;
        }

        get cableVdrop() {
            return this.cableOhm * this.current;
        }

        get cableLoss() {
            return this.cableOhm * this.current * this.current;
        }

        get cableLossMax() {
            return this.cableOhm * this.Imax * this.Imax;
        }

        tick() {
            var IselfMax = 0;
            var Vmin = this.voltage;
            if (this.parent) {
                this.voltage = Math.max(0, this.parent.voltage - this.cableVdrop);
                var VdropMax = this.Imax * this.cableOhm;
                Vmin = this.parent.voltage - VdropMax;
                IselfMax = this.Pself / Vmin;
            }

            // Simulate current values
            var Iself = this.voltage == 0 ? 0 : this.Pself / this.voltage;
            var Ireq = this.Ipoes + this.Ikids + Iself;
            // Current has inertia. Get closer to desired by 25%
            this.current = this.current + (Ireq - this.current) * 0.05;
            if (!this.parent) {
                // Cap power supply current, circuit breaker?
                if (this.current > this.Imax) 
                    this.current = this.Imax;                
            } else {
                if (this.current > topology.nodes[0].Imax)
                    this.current = topology.nodes[0].Imax;
            }

            this.instPower = this.voltage * this.current;
            this.Pmax = Vmin * this.Imax;

            // Available I before brownout:
            this.Ifloor = this.Imax - IselfMax;
            this.Ispare = this.Ifloor > 0 ? this.Ifloor : 0;
            this.Pspare = this.Ispare * Vmin;

            if (this.kids.some(kid => kid.current == 0)) {
                // If we don't know kids' consumption, distribute evenly
                var IspareKid = this.Ispare / this.kids.length;
                this.kids.forEach(kid => kid.Imax = IspareKid);
            } else {
                // For known consumption, distribute proportionally to balance uneven tree
                var quota = this.Ispare / this.Ikids;
                this.kids.forEach(kid => kid.Imax = kid.current * quota);
            }

        }
    }

    var topology = new Topology();
    var ups = topology.addNode('UPS', 'ps');
    ups.addChild('My NS60');

    $scope.topology = topology;

    $scope.editCableLength = function(node) {
        var value = prompt("Cable Length", node.cableLen);
        if (value)
            node.cableLen = value;
    };

    $scope.editVoltage = function(node) {
        var value = prompt("Voltage", node.voltage);
        if (value)
            node.voltage = value;
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

    $scope.play();

});

powerApp.controller('aboutController', function($scope) {
    $scope.message = 'I am an about page.';
});