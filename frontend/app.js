// express app that serves html files

var express = require('express');
var app = express();

/*
var path = require('path');
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname + '/public/index.html'));
});
*/

// ejs model used to template data from node.js to you html 
app.set('view engine', 'ejs');

//URL from where frontend will detch data from the backend. Currently it's hardcoded
//const URL = 'http://localhost:8000/api';


//Get the URL from the environment variable 
//OR If environment vaibale is not present then fetch directly from http://localhost:8000/api
const URL = process.env.BACKEND_URL || 'http://localhost:8000/api';

const fetch = (...args) =>
    import('node-fetch').then(({default: fetch}) => fetch(...args))

app.get('/', async function (req, res) {
    const options = {
        method: 'GET'
    };
    fetch(URL, options)
        .then(res => res.json())
        .then(json => console.log(json))
        .catch(err => console.error('error:' + err));
    try {
        let response = await fetch(URL, options);
        response = await response.json();
        res.render('index', response)
    } catch (err) {
        console.log(err);
        res.status(500).json({msg: 'Internal Server Error.'});
    }
});

app.listen(3000, function() {
    console.log('Ares listening on port 3000!');
});