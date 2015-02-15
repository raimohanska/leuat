#! /usr/bin/env node
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

console.log("Connecting to mongo", mongoUrl)
MongoClient.connect(mongoUrl, function(err, conn) {
  if (err) {
    console.log("Failed to connect to mongo", err)
    throw err
  }
  leuat = conn.collection("leuat")
})

function summary(callback) {
  return Bacon.fromNodeCallback(
    leuat, "aggregate", [{$group: { _id:"$team", leukoja: { $sum: "$leukoja" }  }}]
  ).map(function(list) {
    return list
      .sort(function(a,b) { return b.leukoja-a.leukoja })
      .map(function(a) { return { team: a._id, leukoja: a.leukoja }})
  })
}

io.on('connection', function(socket){
  console.log('User connected')
  socket.on("leuka", function(msg) {
    console.log("LEUKA, MAIJAI!", msg.team)
    leuat.insert({team: msg.team, leukoja: msg.leukoja, vetaja: msg.vetaja, date: new Date()})
    sendSummary()
  })
  socket.on("leuat", sendSummary)
  function sendSummary() {
    summary().onValue(socket, "emit", "leuat")
  }
})

app.use(express.compress())
app.use(express.json())
app.use('/', express.static(__dirname + '/public'))
app.use('/', express.static(__dirname + '/node_modules/baconjs/dist'))
app.use('/', express.static(__dirname + '/node_modules/jquery.cookie'))
http.listen(port, function() {
  console.log("Vedä leukoi! " + port)
})
