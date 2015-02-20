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
  return Bacon.fromNodeCallback(
    leuat, "aggregate", [{$group: { _id:"$team", leukoja: { $sum: "$leukoja" }  }}]
  ).map(function(list) {
    return list
      .sort(function(a,b) { return b.leukoja-a.leukoja })
      .map(function(a) { return { team: a._id, leukoja: a.leukoja }})
  })
}

function statsE(query, start, end) {
  return Bacon.fromNodeCallback(leuat, "aggregate", { 
    $match: _.extend({}, query, dateBetweenQuery(start, end))
  },
  { $group: { _id : null, sum : { $sum: "$leukoja" } } })
    .map(function(list) {
      if (list.length) return list[0].sum
      return 0    
    })
}

function multiStats(query, interval, count) {
  var statArr = []
  var diff = 0
  for (var i = 0; i < count; i++) {
    statArr.push(statsE(query, diff - interval + 1, diff + 1))
    diff -= interval
  }
  return Bacon.combineTemplate(statArr)
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
  var discoE = Bacon.fromEvent(socket, "disconnect")
  socket.on("leuka", function(msg) {
    leuat.insert({team: msg.team, leukoja: msg.leukoja, vetaja: msg.vetaja, date: new Date()})
    leuatBus.push()
  })
  Bacon.fromEvent(socket, "leuat").flatMap(summary).onValue(send)
  statusUpdateE.takeUntil(discoE).onValue(send)
  function send(data) {
    socket.emit("leuat", data)
  }
})

function serveStats(stats, res) {
  stats.onValue(function(data) {
    res.end(JSON.stringify(data))
  })
}

app.get("/leuat/vetaja/:vetaja/:interval/:count", function(req, res) {
  serveStats(multiStats({vetaja: req.params.vetaja}, req.params.interval, req.params.count), res)
})

app.get("/leuat/team/:team/:interval/:count", function(req, res) {
  serveStats(multiStats({team: req.params.team}, req.params.interval, req.params.count), res)
})

app.get("/leuat/all/:interval/:count", function(req, res) {
  serveStats(multiStats({}, req.params.interval, req.params.count), res)
})

app.use(express.compress())
app.use(express.json())
app.use('/', express.static(__dirname + '/public'))
app.use('/', express.static(__dirname + '/node_modules/baconjs/dist'))
app.use('/', express.static(__dirname + '/node_modules/jquery.cookie'))
app.use('/', express.static(__dirname + '/node_modules/chart.js'))
http.listen(port, function() {
  console.log("Vedä leukoi! " + port)
})
