'use strict'
let category; //category of page, associated with id = 'CategoryHeading', we transmit this to backend & for fileprint folder
// this necessitates filerprint folder naming == categoryHeading == backend (webflow cms api search)
let filename; //filename associated with image, img.alt (set image alt text = filename on pc to be printed.
let title; //title of art page, id= 'artTitle'
let readerConnected = false; //readerConnected check for buy button, if not connected, idempotecy 1~2 sec.
let payID; //use for storing payID so its possible to cancel payment
let buyButton;
let loader;

const price = 300;
const homepage = 'https://jasons-stellar-project-02697f.webflow.io/'; //used when we redirect to home page after print success
const backend = 'https://fast-forest-99052.herokuapp.com';

async function fetchConnectionToken() { //function to authenicating to backend
    try {
        //console.log("fetching!cToken");
        const response = await fetch(`${backend}/connection_token`, {
            method: "POST"
        });
        const data = await response.json();
        //console.log("connectionTokenfetched");
        return data.secret;
    } catch (err) {
        console.log(err);
    }
}

async function unexpectedDisconnect() { //triggered on terminal disconnection
    try {
        //console.log("Reader disconnected");
        connectReaderHandler();
        //do nothing
    } catch (err) {
        console.log(err);
    }
}

const terminal = StripeTerminal.create({ //creates terminalObject etc, interface with physical reader
    onFetchConnectionToken: fetchConnectionToken,
    onUnexpectedReaderDisconnect: unexpectedDisconnect, //need unexpectedDisconnectfunction
});

// Handler for a "Connect Reader" button
async function connectReaderHandler() { //connectets terminal/reader with client side app
    try {
        const config = {
            simulated: false
        };
        const discoverResult = await terminal.discoverReaders(config);
        if (discoverResult.error) {
            //console.log('Failed to discover: ', discoverResult.error);
        } else if (discoverResult.discoveredReaders.length === 0) {
            //console.log('No available readers.');
        } else {
            // Just select the first reader here.
            const selectedReader = discoverResult.discoveredReaders[0];
            //console.log('discovered reader');
            const connectResult = await terminal.connectReader(selectedReader);
            if (connectResult.error) {
                console.log('Failed to connect, reconnecting: ', connectResult.error);
                setTimeout(connectReaderHandler, 2000);
            } else {
                //console.log('Connected to reader: ', connectResult.reader.label);
                readerConnected = true;
            }
        }
    } catch (err) {
        console.log(err);
    }
};

async function captureServer(idCap) { //tells server to capture payment
    try {
        const capResponse = await fetch(`${backend}/capture_payment_intent?payment_intent_id=${idCap}`, {
            method: "POST"
        });
    } catch (err) {
        console.log(err);
    }
    //console.log('payment captured!');
}



async function createPayIntent() { //starts Payment process, triggered by StripeBuy button click.
    try {

        if (!readerConnected) { //if reader is not connected we restart in 1 sec, however this introduces issues of idemtepocy
            setTimeout(createPayIntent, 1000);
            return;
        }
        const autoCancel = setTimeout(cancelPayIntent, 30000); //auto cancels payment if 30 sec has passed
        //this needs to be clearTimeout when paySuccess or user initiates cancel.
        //console.log("starting Payment");
        //calls back-end to initiate payment
        const filepath = category + '\\' + filename; //since our filepath has to be unique (otherwise, can't print, we can use as idem key.)
        const response = await fetch(`${backend}/create_payment_intent?amount=${price}&description=${title}&category=${category}&idem=${filepath}`, {
            //we need to feed the data, based on amount & description
            method: "POST"
        });

        //backend returns secret key
        const resJson = await response.json(); //convert to JSON format, returned is payment intent obj
        const clientSecret = resJson.secret;
        payID = resJson.intent;
        //client passes secret to terminal, tells it to collect payment
        terminal.collectPaymentMethod(clientSecret).then(function (result) {
            if (result.error) {
                console.log('terminal result.error triggered');
                clearTimeout(autoCancel);
                // Placeholder for handling result.error
            } else {
                //console.log("terminalCollect success");
                terminal.processPayment(result.paymentIntent).then(function (resultP) { //waiting for terminal success/fail
                    if (resultP.error) {
                        // Placeholder for handling result.error
                    } else if (resultP.paymentIntent) { //success!
                        captureServer(result.paymentIntent.id); //we tell backend to 'capture' that payment. Not sure what capturing is, but presumably backend contacts stripe
                        window.location.href = "ifranprint:" + category + '/' + filename; //this tells file print, in conjuction with registry protocol handler
                        // Placeholder for notifying your backend to capture result.paymentIntent.id
                        let nowpay = document.getElementById('nowPay');
                        nowpay.style.display = 'none'; //turns off payment popup
                        let printingwait = document.getElementById('printingwait');
                        printingwait.style.display = 'block'; //turns on printing wait popup
                        fetchPrintStatus();
                        clearTimeout(autoCancel);
                    }
                });
                // Placeholder for processing result.paymentIntent
            }
        });
    } catch (err) {
        console.log(err);
    }
    // console.log(payIntent + clientSecret + "createResponse");
};

async function cancelPayIntent() { //triggered when users clicks X button
    //sends cancel Payment Intent to server
    try {
        const cancelPayment = await fetch(`${backend}/cancelPayIntent?id=${payID}`, {
            method: "POST"
        });
        //console.log(cancelPayment);
        let cancelTerminal = await terminal.cancelCollectPaymentMethod();
        //console.log(cancelTerminal);
    } catch (error) {
        console.log(error);
    }

}



function fetchPrintStatus() { //called when payment success

    const source = new EventSource(`${backend}/stream`); //this is being created
    source.onmessage = function (event) {
        //console.log("stream msg received") //currently no streamMsg is getting received.
        let printStatus = event.data;
        switch (printStatus) {
            case 'success':

                setButton();
                //console.log('got success message');
                source.close();
                loader.style.display = "none";
                window.location.replace(homepage); //redirect to homepage
                break;
        }

    };
}

function setButton() {

    buyButton.onclick = function () {
        createPayIntent();
        loader.style.display = "block";
        buyButton.onclick = null;
    }
}


//connectReaderHandler(); //connect on page load. well obviously we dont want to repeat this every time we navigate a page, so we ... ?
document.addEventListener('readystatechange', event => { //window.onload() wasn't working previously because page finished loaded before script, hence it started was never callsed
    if (event.target.readyState === 'interactive') {
        connectReaderHandler();
        //initLoader();
    } else if (event.target.readyState === 'complete') {
        loader = document.getElementById('loaderParent');
        buyButton = document.getElementById('stripebuy');
        setButton();
        category = document.getElementById('categoryHeading').innerText.toLowerCase(); //this demands no exclaimination marks, or we cut last unit, either is fine
        category = category.substr(0, (category.length - 1)); //test to see if this works

        // console.log(img);
        filename = document.getElementById('filename').innerText;
        // console.log(filename);
        title = document.getElementById('artTitle').innerText;
        //console.log(filename);

        document.getElementById('closeButton').onclick = function () { //close button on loader
            //we should cancel pay request, disable loader
            loader.style.display = "none";
            cancelPayIntent();
            setButton();
        }
    }
});

// connectReaderHandler();