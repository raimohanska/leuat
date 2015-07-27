#! /usr/bin/env node
"use strict";
var express = require('express')
var port = process.env.PORT || 8666
var app = express()
var http = require('http').Server(app)
var io = require('socket.io')(http)
var Bacon = require("baconjs")
var _ = require("lodash")
var MongoClient = require('mongodb').MongoClient
var mongoUrl = process.env["MONGOLAB_URI"] || "mongodb://localhost/leuat"
var leuat
var leuatBus = new Bacon.Bus()

MongoClient.connect(mongoUrl, function(err, conn) {
  if (err) {
    console.log("Failed to connect to mongo", err)
    throw err
  }
  leuat = conn.collection("leuat")
})

function summary() {
  console.log("calculate summary")
  var sevenDays = 7 * 24 * 60 * 60 * 1000;
  return Bacon.fromNodeCallback(
    leuat, "aggregate", [{
          $project: {
            _id: 0,
            team: 1,
            leukoja: 1,
            last: {$cond: [
              {$gt: ["$date", new Date(new Date().getTime() - sevenDays)]},
              "$leukoja",
              0
            ]}
          }
        }, {
          $group: {
            _id: "$team",
            leukoja: {$sum: "$leukoja"},
            muutos: {$sum: "$last"}
          }
        }]
  ).map(function(list) {
    return list
      .sort(function(a,b) {
        var muutos = b.muutos - a.muutos;
        return muutos != 0 ? muutos : b.leukoja-a.leukoja;
      })
      .map(function(a) { return { team: a._id, leukoja: a.leukoja, muutos: a.muutos }})
  })
}

function statsE(queryParam, groups, start, end) {
  var groupBy = null
  var query = {}
  if (queryParam) {
    groupBy = "$" + queryParam
    query[queryParam] =  {$in: groups}
  }
  return Bacon.fromNodeCallback(leuat, "aggregate", { 
    $match: _.extend({}, query, dateBetweenQuery(start, end))
  },
  { $group: { _id : groupBy, sum : { $sum: "$leukoja" } } })
}

function multiStats(queryParam, groups, interval, count) {
  var statArr = []
  var diff = 0
  for (var i = 0; i < count; i++) {
    statArr.push(statsE(queryParam, groups, diff - interval + 1, diff + 1))
    diff -= interval
  }
  statArr = statArr.reverse()
  return Bacon.combineTemplate(statArr)
    .map(function(statsByDate) {
      var groupedResults = {}
      statsByDate.forEach(function(dayStats) {
        var groupedDayStats = {}
        dayStats.forEach(function(groupStatsForDay) {
          groupedDayStats[groupStatsForDay._id] = groupStatsForDay.sum
        })
        groups.forEach(function(groupId) {
          groupedResults[groupId] = (groupedResults[groupId] || []).concat(groupedDayStats[groupId] || 0)
        })
      })
      return groupedResults
    })
}

function dateBetweenQuery(start, end) {
  return { $and: [
    { date: { $gte: dateStart(start) } },
    { date: { $lte: dateStart(end) } }
  ]}
}

function dateStart(diff) {
  var d = new Date(new Date().getTime() + 86400000 * diff)
  d.setHours(0,0,0,0)
  return d
}

var statusUpdateE = leuatBus.flatMap(summary)

io.on('connection', function(socket){
  console.log("socket connected")
  var discoE = Bacon.fromEvent(socket, "disconnect")
  socket.on("leuka", function(msg) {
    leuat.insert({team: msg.team, leukoja: msg.leukoja, vetaja: msg.vetaja, date: new Date()})
    leuatBus.push()
  })
  Bacon.fromEvent(socket, "leuat")
    .takeUntil(discoE)
    .map()
    .log("leuat requested")
    .flatMap(summary)
    .onValue(send)
  statusUpdateE.takeUntil(discoE).onValue(send)
  discoE.log("socket disconnect")
  function send(data) {
    console.log("sending leuat")
    socket.emit("leuat", data)
  }
})

function serveStats(stats, res) {
  stats.onValue(function(data) {
    res.end(JSON.stringify(data))
  })
}
/*
app.get("/leuat/vetaja/:vetaja/:interval/:count", function(req, res) {
  serveStats(multiStats("vetaja", req.params.vetaja.split(","), req.params.interval, req.params.count), res)
})

app.get("/leuat/team/:team/:interval/:count", function(req, res) {
  serveStats(multiStats("team", req.params.team.split(","), req.params.interval, req.params.count), res)
})

app.get("/leuat/all/:interval/:count", function(req, res) {
  serveStats(multiStats(null, [null], req.params.interval, req.params.count), res)
})
*/

app.use(express.compress())
app.use(express.json())
app.use('/', express.static(__dirname + '/public'))
app.use('/', express.static(__dirname + '/node_modules/baconjs/dist'))
app.use('/', express.static(__dirname + '/node_modules/jquery.cookie'))
app.use('/', express.static(__dirname + '/node_modules/chart.js'))
http.listen(port, function() {
  console.log("Vedä leukoi! " + port)
})
