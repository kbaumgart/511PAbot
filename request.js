const http = require('http');
const express = require('express');
const app = express();

app.get("/", (request, response) => { //this section here to kelp keep the bot alive
  console.log(Date.now() + " Ping Received");
  response.sendStatus(200);
});
app.listen(process.env.PORT);
setInterval(() => {
  http.get(`http://${process.env.PROJECT_DOMAIN}.glitch.me/`);
}, 280000);
//-------------------------------------------------------------------------------------------------------------------------------
const time = require('moment-timezone')
const request = require("request")
const config = require("./config.json") //contains small configuration options, will be moved to the .env file
const sql = require('sqlite')
const Discord = require("discord.js")
const counties = require("./counties.json") //key:value pairs of county codes to county names
const closure = ['ramp closure', 'closed'] // typical PennDOT nomenclature for when a road segment is completely impassable
const pa511 = new Discord.WebhookClient('428918228832747521', process.env.webhooktoken) //webhook client until the full bot is implemented
const color = require("./color.json")
//-------------------------------------------------------------------------------------------------------
//basic options for the get request to the RCRS API
var headers = { "Authorization" : "Basic " + process.env.PAToken};
var params = { "url": process.env.URL, "method":"GET", "headers": headers }

//open up the sqlite database housing info on current and past traffic events
sql.open("./PA511")

//request from the RCRS API every 60 seconds, maybe be adjusted in the future
setInterval(function() {
    request(params, callback)}, 60*1000
    )
//callback from the request response to do the parsing
function callback (err, res, body) { 
    console.log('Checking 511PA...')
    let json = JSON.parse(body)
    let loop = json.Values.length
        for (let i=0; i < loop; i++) { //run a loop of all responses
        let entry = json.Values[i];   
        sql.get(`SELECT * FROM PA511 WHERE EventID = ${entry.EventID}`).then(row => { //does the EventID exist? If so, get all values
            let check = `UPDATE PA511 SET LaneStatus =  \"${entry.LaneStatus}\" WHERE EventID = ` + entry.EventID //simple variable to use to update the db when the time comes
            if (!row) {  //if the EventID does not exist, add it
                sql.run(`INSERT INTO PA511 (EventID, Facility, LaneStatus, Description, EventClass, EventType, County, IncidentMuniName, FromLocLatLong, ToLocLatLong, IncidentLocLatLong, DateTimeVerified, DateTimeNotified, CreateTime, LastUpdate, DetourInEffect, ActualDateTimeOpened, MessageID, ClosedBy, SegmentIDs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, returnData(entry));
               if (closure.includes(entry.LaneStatus) == true) { //If the lane status of this EventID is closed, send a message to the closure channel, and to the log
                  console.log(`Closure added for ${entry.Facility} because of ${entry.Description}`)
                 pa511.send(ClosureEmbed(entry)).then(msg => { sql.run(`UPDATE PA511 SET MessageID = ${msg.id} WHERE EventID = ` + entry.EventID) } )
               }
                else {
                console.log(`${entry.EventID} added as ${entry.Description}`)} //if it isn't a closure, just report out to the console - just here for error checking at this time, probably will be removed in the future
        }
        if (row.LaneStatus !== entry.LaneStatus) { //if the current lane status and prior lane status don't match, let's look closer
            if (closure.includes(row.LaneStatus) == true || closure.includes(entry.LaneStatus) == true) { //if either current or past is or was closed, we need to send a message
                if (closure.includes(entry.LaneStatus) == true) { 
                  console.log(`Closure added for ${entry.Facility} because of ${entry.Description}`)
                  pa511.send(ClosureEmbed(entry)).then(msg => { sql.run(`UPDATE PA511 SET MessageID = ${msg.id} WHERE EventID = ` + entry.EventID) } ) } //if the current status is now closed, send a closure message
                if (closure.includes(row.LaneStatus) == true) { //if the current status isn't closed, we need to open up that segment
                    pa511.send(sendOpenMsg(entry))
                    console.log(`${entry.EventID} ${entry.Facility} in ${entry.IncidentMuniName}, ${counties[entry.County]} remove closure`)} //report out to console, will be removed
                else {
                     console.log(`${entry.EventID} changed to ${entry.LaneStatus} from ${row.LaneStatus}`) } //just an update for minor things to console, not really needed
                sql.run(check)} //in any case - update the db with the new info
            else {
                console.log(`${row.EventID} changed from ${row.LaneStatus} to ${entry.LaneStatus}`)
                if (entry.LaneStatus == 'open') {
                    sql.run(`UPDATE PA511 SET ActualDateTimeOpened = \"${TimeCorrect(entry.ActualDateTimeOpened)}\" WHERE EventID = ` + entry.EventID)
                    //sql.run(`DELETE FROM PA511 WHERE EventID = ${entry.EventID}`)
                    console.log(`${entry.EventID} deleted`) }
                sql.run(check)
            }
        };
        })
        .catch(() => {
           console.error
            sql.run("CREATE TABLE IF NOT EXISTS PA511 (EventID INTEGER, Facility TEXT, LaneStatus TEXT, Description TEXT, EventClass INTEGER, EventType TEXT, County INTEGER, IncidentMuniName TEXT, FromLocLatLong TEXT, ToLocLatLong TEXT, IncidentLocLatLong TEXT, DateTimeVerified TEXT, DateTimeNotified TEXT, CreateTime TEXT, LastUpdate TEXT, DetourInEffect TEXT, ActualDateTimeOpened TEXT, MessageID INTEGER, ClosedBy INTEGER, SegmentIDs INTEGER)").then(() => {
                sql.run(`INSERT INTO PA511 (EventID, Facility, LaneStatus, Description, EventClass, EventType, County, IncidentMuniName, FromLocLatLong, ToLocLatLong, IncidentLocLatLong, DateTimeVerified, DateTimeNotified, CreateTime, LastUpdate, DetourInEffect, ActualDateTimeOpened, MessageID, ClosedBy, SegmentIDs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, returnData(entry));
           })
            
        })
    }
    console.log('Update Complete!')
}
function returnData(y) { //format a comma seperated return for insertion into the sql database of relevent datapoints
    return [ y.EventID, y.Facility, y.LaneStatus, y.Description, y.EventClass, y.EventType, counties[y.County], y.IncidentMuniName, y.FromLocLatLong, y.ToLocLatLong, y.IncidentLocLatLong, TimeCorrect(y.DateTimeVerified), TimeCorrect(y.DateTimeNotified), TimeCorrect(y.CreateTime), TimeCorrect(y.LastUpdate), y.DetourInEffect, y.ActualDateTimeOpened, "", "", ""]
}

function CreateLink(k) { //create a WME permalink from a given lat/long pair
    var link = `https://www.waze.com/en-US/editor/?env=usa&lon=${k.split(',')[1]}&lat=${k.split(',')[0]}&zoom=4&marker=true`
    return link
}

function TimeCorrect(a) { //create a ISO compliant timestamp adjusting for Timezone
    let t = new Date(a).toISOString()
    let x = time.tz(a, 'America/New_York')
    //let x = new Date(t + (t.getTimezoneOffset() * 60000))
    return x.format()
}

request(params, callback)
function ClosureEmbed(d) { //create the embed used to send via the webhook
    if (d.FromLocLatLong === "") { 
        var FromLatLong = d.IncidentLocLatLong
        var ToLatLong = d.IncidentLocLatLong}
    else { 
        var FromLatLong = d.FromLocLatLong; 
        var ToLatLong = d.ToLocLatLong }
  var closeEmbedhook = { 
        "embeds": [ 
            {
            "title": `${d.Facility} closed due to ${d.EventType}`,
            "url": "https://511PA.com",
             "color": color[d.EventType],
             "timestamp": TimeCorrect(d.CreateTime),
             "footer": {
          "icon_url": "https://pbs.twimg.com/profile_images/743481571538243585/WX01GtGM_400x400.jpg",
          "text": `Event ${d.EventID} updated at`
        },
          "author": {
          "name": "511PA DataFeed",
          "url": "https://511PA.com",
          "icon_url": "https://pbs.twimg.com/profile_images/743481571538243585/WX01GtGM_400x400.jpg"
        },
          "fields": [ 
            {
                "name": "Reason",
                "value": d.Description
            },
            {"name": "From",
                 "value":  `[WME Link](${CreateLink(FromLatLong)})`
            },
            {
                 "name": "To",
                 "value": `[WME Link](${CreateLink(ToLatLong)})`
            },
            {"name": "Municipality",
            "value": d.IncidentMuniName,
            "inline": true},
            {"name": "County",
            "value": counties[d.County],
            "inline": true}

        ]
  }]}
return closeEmbedhook
}  

function sendOpenMsg(d) { //create an embed used to send on opening of a road segment via the 
    if (d.FromLocLatLong === "") { 
        var FromLatLong = d.IncidentLocLatLong
        var ToLatLong = d.IncidentLocLatLong}
    else { 
        var FromLatLong = d.FromLocLatLong; 
        var ToLatLong = d.ToLocLatLong}
    let openEmbed = {  "embeds": [{
    "title": `${d.Facility} was closed due to ${d.EventType}`,
    "color":  1505030,
    "timestamp": TimeCorrect(d.LastUpdate),
    "footer": {
      "icon_url": "https://pbs.twimg.com/profile_images/743481571538243585/WX01GtGM_400x400.jpg",
      "text": `Event ${d.EventID} updated at`
    },
    "author": {
      "name": "511PABot",
      "url": "https://511PA.com",
      "icon_url": "https://pbs.twimg.com/profile_images/743481571538243585/WX01GtGM_400x400.jpg"
    },
    "fields": [
      { "name": "Reason",
       "value": d.Description
      },
      {
        "name": "From",
        "value": `[WME Link](${CreateLink(FromLatLong)})`
      },
      {
        "name": "To",
        "value": `[WME Link](${CreateLink(ToLatLong)})`
      },
      {
        "name": "Municipality",
        "value": d.IncidentMuniName,
        "inline": true
      },
      {
        "name": "County",
        "value": counties[d.County],
        "inline": true
      }
    ]
  }]
}
return openEmbed
  }
