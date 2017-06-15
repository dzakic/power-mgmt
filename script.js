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
    $scope.PS_MAXW = 200;

    class Topology {
        constructor() {
            this.nodes = [];
        }
        addNode(name, type) {
            var node = new Node(name, type);
            node.id = this.nodes.length;
            node.name = name ? name : node.type.toUpperCase() + "-" + node.id;;
            node.topology = this;
            this.nodes.push(node);
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
            this.cableLen = 0;
            this.current = 0;
            if (this.type == 'ns') {
                this.power = $scope.NS_POWER;
            } else if (this.type == 'ps') {
                this.power = 0;
                this.voltage = $scope.PS_VOLTAGE;
                this.maxpower = $scope.PS_MAXW;
                this.maxcurrent = this.maxpower / this.voltage;
            }
        }

        addChild(name, type) {
            var child = this.topology.addNode(name, type);
            this.kids.push(child);
            child.parent = this;
            child.level = this.level + 1;
            child.cableLen = 200;
        }

        delete() {
            var kidIndex = this.parent.kids.indexOf(this);
            this.parent.kids.splice(kidIndex, 1);
        }

        get totalPower() {
            var totalPoEpower = PoEs.reduce((a, b) => a.power + b.power, 0);
            var totalKidspower = kids.reduce((a, b) => a.power + b.power, 0);
            return this.power + totalPoEpower;
        }

        get totalKidsCurrent() {
            var current = 0;
            this.kids.forEach(function(kid) {
                current += kid.current;
            });
            return current;
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

        tick() {
            if (this.parent)
                this.voltage = Math.max(0, this.parent.voltage - this.cableVdrop);

            var requiredMyCurrent = this.voltage == 0 ? 0 : this.power / this.voltage;
            var requiredCurrent = this.totalKidsCurrent + requiredMyCurrent;
            // Current has inertia. Get closer to desired by 25%
            this.current = this.current + (requiredCurrent - this.current) * 0.25;

            // Available I before brownout:
            this.deltacurrent = this.maxcurrent - this.current;
            var eachKidDeltaCurrent = this.deltacurrent / this.kids.length;
            this.kids.forEach(kid => kid.deltacurrent = eachKidDeltaCurrent);

            this.instPower = this.voltage * this.current;
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