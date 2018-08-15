import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

class Utils {
    static shuffleArray(array) {
        let currentIndex = array.length, temporaryValue, randomIndex;
        // While there remain elements to shuffle...
        while (0 !== currentIndex) {
            // Pick a remaining element...
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;

            // And swap it with the current element.
            temporaryValue = array[currentIndex];
            array[currentIndex] = array[randomIndex];
            array[randomIndex] = temporaryValue;
        }
        return array;
    }
}


// Listen for a new job request and send out push notifications to drivers
// TODO: Think about better way of randomly pushing to drivers

// TODO: Need to set up a channel that alerts the notify whether or not the driver accepted the job
function notifyDriverAndWaitForResponse(deviceToken: string, payload: any) {
    // TODO: Turn this into an async - await function
     admin.messaging().sendToDevice(deviceToken, payload)
        .then(messagingDeviceResponse => {
            console.log('Messaged pushed.');
            console.log(messagingDeviceResponse);
        }, err => {
            console.log("Could not push message");
            console.log(err);
        });

}

exports.notifyDriversOfNewJobRequests = functions.firestore
    .document( 'jobRequests/{requestId}')
    .onCreate((snap, context) => {
        const requestData = snap.data();
        const requestId = snap.id;
        // Get a list of current drivers
        const driverRef = admin.firestore().collection('driverProfile');
        return driverRef.get().then(driverSnap => {
            // Get driver data
            let driverArray = Utils.shuffleArray(driverSnap.docs.map(doc => [doc.id, doc.data()]));
            // Shuffle driver data
            // Utils.shuffleArray(driverSnap.docs.map(doc => [doc.id, doc.data()]))
            for (let driverData of driverArray) {
                const driverId = driverData[0];
                const data = driverData[1];
                const payload = {
                    notification: {
                        title: `Job request ${requestId} available.`,
                        body: `${requestData.clientRef.id} has requested a job.`,
                        sound: "default",
                        click_action: "FCM_PLUGIN_ACTIVITY"
                    },
                    "data": {
                        driverId: driverId,
                        clientId: requestData.clientRef.id,
                        requestId: requestId
                    }
                };
                notifyDriverAndWaitForResponse(data.deviceToken, payload);
                // return admin.messaging().sendToDevice(data.deviceToken, payload)
                //     .then(messagingDeviceResponse => {
                //         console.log('Messaged pushed.');
                //         console.log(messagingDeviceResponse);
                //     }, err => {
                //         console.log("Could not push message");
                //         console.log(err);
                //     });
            };
        }, err => {
            console.log(err);
        });
    });

