'use strict';

const createError = require('http-errors');
const http = require('http');
const https = require('https');
const path = require('path');
const PORT = process.env.PORT || 5000
const url = require('url');
const cors = require('cors');
const Webflow = require('webflow-api');
const fetch = require('node-fetch');

require('dotenv').config();

const apiKey = (() => {
  if (process.env.keyMode != 'live') {
    return "dsjfisadfjoasfja"; //test key
  } else {
    return "ajfisdjfoasifjsd" //live key
  }
})();

const stripe = require("stripe")(apiKey); //test key
stripe.setApiVersion('2019-05-16');

let payID; //current payID of session

const express = require('express');

const cookieParser = require('cookie-parser');
//var logger = require('morgan');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

//webflow stuff
const webfKey = 'fasjfiosajfiosjfosi'; //our webflow api key
let clientStream = null; //we store SSE object, set to null after client closes
let artTitle; //we store artTtitle, passed from client, used for CMS api updating and stripe title
let currentCat; //we store current Category, ditto above
const categories = []; //empty category we declare, later we feed the contents of categories as MakeCategory objects
const productsID = '5d09d44d3d6e1c722aa96402'; //csm api, _id of our 'products' collection.

//webflow end

const app = express();

//added comments to test
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

//app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({
  extended: false
}));


app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

const corsOptions = {
  origin: '*',
  optionsSuccessStatus: 200,
  methods: 'GET, POST, OPTIONS',
  allowedHeaders: 'Authorization, Content-Type, Accept, X-User-Email, X-Auth-Token, Cache-Control, Connection, Origin',
  // credentials: true,
  exposedHeaders: 'Connection'
}
app.options('*', cors(corsOptions)); //enables pre-flight across the board
app.use(cors(corsOptions)); //use cors for all routes


// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});


app.get('/', function (req, res) {
  // res.redirect('/display'); //this does not
});


app.post('/register_reader', async function (req, res) {
  console.log('/register readering');
  try {
    let reader = await stripe.terminal.readers.create({
      registration_code: req.query.registration_code, //this is probably wrong.
      label: req.query.label,
    });
    res.status(200).json(JSON.stringify(reader));
  } catch (err) {
    return res.status(402).send(err);
  }

});



app.post('/connection_token', async function (req, res) {
  console.log('/connection_token ing');
  try {
    let token = await stripe.terminal.connectionTokens.create();
    res.status(200).json({
      secret: token.secret
    });
    console.log('sent secret');
  } catch (err) {
    return res.status(402).send(err);
  }
});

async function cancelPay(_payID) {
  try {
    let payment_intent = await stripe.paymentIntents.cancel(_payID);

  } catch (err) {
    console.log(err);
  }
}



app.post('/cancelPayIntent', async function (req, res) {
  console.log('/cancel Pay Intent');
  try {
    cancelPay(payID);
    //cancel success
    res.status(200).json({ //sends payId and client secret back to client
      status: 'cancelled' //probably should make this what we get back from stripe instead
    });
  } catch (err) {
    return res.status(200).json({
      status: 'cancel fail'
    })
  }
});


app.post('/create_payment_intent', async function (req, res) {
  console.log('/create_payment_intent');
  try {
    let payment_intent = await stripe.paymentIntents.create({
        amount: req.query.amount,
        payment_method_types: ['card_present'],
        capture_method: 'manual',
        currency: 'usd',
        description: req.query.description || 'Example PaymentIntent', //this we will feed into, it will be artTitle
        metadata: {
          Category: req.query.category
        }

      }
      // , {
      //   idempotency_key: req.query.idem //we are currently using filepath as idem_key. if this works, we can replace category all together
      // }
      //re-enable this for live
    );
    res.status(200).json({
      intent: payment_intent.id,
      secret: payment_intent.client_secret
    });
    artTitle = req.query.description; //we feed this into updateCMS later
    currentCat = req.query.category;
    payID = payment_intent.id; //save this so we can cancel

  } catch (err) {
    return res.status(402).send(err);
  }
});


app.post('/capture_payment_intent', async function (req, res) {
  console.log('capturing payment intent');
  try {
    let id = req.query.payment_intent_id;
    let payment_intent = await stripe.paymentIntents.capture(id);
    res.status(200).json({
      intent: payment_intent.id,
      secret: payment_intent.client_secret
    });
    console.log('payment capture success')
  } catch (err) {
    console.log('capture error');
    return res.status(402).send(err);
  }

});


app.get('/stream', async function (req, res, next) {
  console.log('get streaming started');
  try {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked' //there is a transfer-encoding error message in chrome, but does not seem to break it
    });
    clientStream = res;
    res.write('\n');
    req.on('open', () => console.log('started stream'));
    req.on('close', () => { //closes connection upon browser eventsource.close();
      res.end();
      console.log('Stopped sending events.');
      clientStream = null; //sets to null
    });
    //timer every 2:30 min to cancel payIntent automatically, if we don't hear back from printer
    //this requires we clear timer
    //let cancelTimer = setTimeout(cancelPay, 150000, payID);
  } catch (err) {
    console.log(err);
  }

  next();

});


app.post('/print_status', async function (req, res) {
  console.log('got message from printer')
  try {
    let retry = 0;

    async function streamNotify(_retry) {
      try {
        if (clientStream) {

          let statusMsg = req.query.msg;
          switch (statusMsg) {
            case "success":
              clientStream.write('data: success\n\n');
              console.log('success message in retry');
              clientStream.end();
              updateCMS(artTitle, currentCat); //removes stuff from cms
              break;

            case "fail":
              clientStream.write('data: fail\n\n');
              console.log('fail message');
              clientStream.end();
              cancelPay(payID);
              break;
          };

        } else {
          console.log('no client stream')
          if (_retry < 6) {
            console.log('retry loop')
            _retry++;
            await sleep(3000);
            return streamNotify(_retry);

          } else {
            console.log('max retry exceeded');
            clientStream.write('data: fail\n\n');
            console.log('fail message');
            clientStream.end();
            cancelPay(payID);
            //send fail message
          }
        }
      } catch (err) {
        console.log(err);
      }
    }
    streamNotify(retry);
    res.status(200).send(); //send ok status

    // clientStream.end();
  } catch (err) {
    console.log(err);
  }

});



//webflow cms code begins below
function MakeCategory(_name, _id) { //for categories
  this.name = _name;
  this.id = _id;
  this.arr = [];
};

function MakeProduct(_title, _id) { //for individual items
  this.name = _title;
  this.id = _id;
  this.sold = false;
};

const webflow = new Webflow({
  token: webfKey //our api key
});

//siteId: '5d09d44d3d6e1ca965a963da'
//skuid; 5d09d44d3d6e1c98e5a9641b
//productsID; 5d09d44d3d6e1c722aa96402
//collectionId: '5d09d44d3d6e1c6084a9642e' //collection id of 'category'

async function initCats() { //find _id of "racism", "health" etc. These are actually items which belong to collection "category"

  try {
    const categoryItem = await webflow.items({ //gets all items of a collection
      collectionId: '5d09d44d3d6e1c6084a9642e' //collection id of 'category'
    }, {
      limit: 50
    });
    //the response format is {items: [{},{},...}], count: , etc, }
    //console.log("categoryItem:  " + categoryItem);
    const tempCat = categoryItem.items;
    //console.log("tempCat  " + JSON.stringify(tempCat));
    for (let i = 0; i < tempCat.length; i++) {
      //console.log(tempCat[i]);
      const copyCat = new MakeCategory(tempCat[i].description, tempCat[i]._id);
      //makes an object of {name: racism, id: f1323121, arr:[]}
      //to alter which field we match by , change the name --> tempCat[i].example
      categories.push(copyCat);
    }
    //console.log(categories);
    initProducts(); //now we match products with their respective categories
  } catch (err) {
    console.log(err);
  }
}


async function initProducts() {
  try {
    const itemCount = await webflow.items({
      collectionId: productsID //collection of products
    });
    //console.log(itemCount);
    //const remain = total % 100; //we don't need remain because we dont need exact numbers for the last one
    const whole = Math.floor(itemCount.total / 100); //finds lowest  750, 7 calls, Ceiling doesn't work when items<100
    //console.log(whole);
    for (let i = 0; i <= whole; i++) { //<= because we really need to make count+1 calls, but offset needs to start at 1
      let tempObjs = await webflow.items({ //we get an object back with items being an arrary
        collectionId: productsID
      }, {
        limit: 100,
        offset: 100 * i
      });

      for (let i = 0; i < tempObjs.items.length; i++) { //forEach probably better here, no because it can't be terminated?
        let currentItem = tempObjs.items[i]; //so this actually works, it gives us objects
        //console.log(currentItem);
        //we sort by array category
        let catID = currentItem.category[0];
        //this gives us the category id of the current item, the category is an array, but for us only 1 category always
        let copyObj = new MakeProduct(currentItem.name, currentItem._id); //this makes a new obj of the stuff we want

        for (let catObj of categories) { //iterate across categories, we match currentItem type ID with pre-existing type
          if (catID === catObj.id) { //if category ID matches name,
            catObj.arr.push(copyObj); // we push the product into the specific cat array
            break;
          }
        }
      }
      //console.log(tempObjs);
    };
    //console.log(categories);
    console.log("webflow init finished");
  } catch (err) {
    console.log(err);
  }

}

function findArtID(_artTitle, _category) { //our retrieval function, we call this on printer finish
  console.log("finding art id with " + _artTitle + " " + _category);
  for (let cat of categories) { //iterate across categories

    if (cat.name === _category) { //if name matches category name, we iterate accross its array
      for (let item of cat.arr) { //iterating across individual items in the array(category)

        if (item.name === _artTitle) { //if name matches artTitle
          console.log("name match, id is" + item.id);
          //we are not matching that is the thing...
          return item.id; //returns item ID
        }
      }
    }
  }
};

async function updateCMS(_artTitle, _currentCat) { //function to update CMS with
  //this assumes your product, category ids are all in sync.
  // siteId: '5d09d44d3d6e1ca965a963da'
  try {
    console.log('updatingCMS')
    //by category find appropaite array. category Obj --> if value
    //find itemID by artTitle
    let itemID = findArtID(_artTitle, _currentCat);
    // const webflowUrl = `https://api.webflow.com/collections/${collectionID}/items/${itemID}/inventory`; //ok this doesn't work for fetch but typing it directly does?
    //using ecommerce above
    //console.log(webflowUrl); //this is resolving correctly
    const webflowUrl = `https://api.webflow.com/collections/${productsID}/items/${itemID}?live=true`;

    let setZero = await fetch(webflowUrl, { //ok this works now, it was try catch error
      method: 'PATCH',
      headers: { // this works
        'Content-Type': 'application/json',
        'accept-version': '1.0.0',
        'Authorization': `Bearer ${webfKey}`
      },
      body: JSON.stringify({ //this works
        fields: {
          _archived: true //so this works.
        }
      }),
    });
    const jsonRes = await setZero.json(); //JSON response of setZero
    console.log(jsonRes);
    artTitle = null; //clears out the value
    currentCat = null;
  } catch (err) {
    console.log(err);
  }
}

function sleep(ms) { //sleep function, used only in async functions with await sleep(milliseconds) ; 60000 = 1 minute
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.listen(PORT, () => console.log(`listening on port ${PORT}!`));
initCats();
//SKU returns every single product
//regardless how we proceed (ecommerce or collection, what we all need to do is on server)
//a map between [name to ID] sorted by category