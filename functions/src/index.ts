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
function notifyDriverAndWaitForResponse(
    deviceToken: string,
    payload: any
): Promise<void> {
     return admin.messaging().sendToDevice(deviceToken, payload)
        .then(messagingDeviceResponse => {
            console.log('Messaged pushed.');
            console.log(messagingDeviceResponse);
            console.log(payload);
        }, err => {
            console.log("Could not push message");
            console.log(err);
        });
}

function isJobAccepted(change: any): boolean {
    const data = change.doc.data();
    return data.accept === true;
}



function listenToChanges(requestId: string, driverId: string): Promise<any> {
    return new Promise((resolve, reject) => {
        admin.firestore().collection('acceptRejectTimeout')
            .doc(`${requestId}`)
            .collection('drivers')
            .onSnapshot(snap => {
                snap.docChanges.forEach(change => {
                    if (change.doc.id == driverId){
                        console.log(`Request response for ${driverId}: `, change.doc.data());
                        resolve(change);
                    }
                });
            });
    });
}


async function notifyDrivers(
    requestId: string,
    requestData: any,
    driverArray: Array<any>): Promise<boolean> {
    // const driverData = driverArray[0];
    if (driverArray.length === 0) {
        return Promise.resolve(false);
    }
    const driverData = driverArray.pop();
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

    console.log(`Sending push notification to ${driverId}`);
    return Promise.all([
        notifyDriverAndWaitForResponse(data.deviceToken, payload),
        listenToChanges(requestId, driverId)
    ]).then(values => {
        console.log(`Response from ${driverId} retrieved.`);
        const changeData = values[1];
        const jobAccepted = isJobAccepted(changeData);
        console.log(`Job accepted by ${driverId}: `, jobAccepted);
        if (jobAccepted) {
            return jobAccepted;
        } else {
            return notifyDrivers(requestId, requestData, driverArray);
        }
    }, err => {
        console.log('Error occurred when notifying drivers: ',
            JSON.stringify(err));
        return false;
    });
}

function retryNotifyDrivers(
    notifyData: Array<any>,
    maxRetries: number,
): Promise<boolean> {
    const requestId = notifyData[0];
    const requestData = notifyData[1];
    const driverArray = notifyData[2];

    return notifyDrivers(requestId, requestData, driverArray)
        .then(jobAccepted => {
        if (jobAccepted) {
            return jobAccepted;
        } else if (maxRetries > 0) {
            return retryNotifyDrivers(
                notifyData,
                maxRetries - 1);
        } else {
            return false;
        }
    }, err => {
        console.log(err);
        return false
    })
}

function removeJobRequestDatabase(requestId: string): Promise<any> {
    return admin.firestore().doc(`jobRequests/${requestId}`).delete().then(() => {
        console.log(`Deleted jobRequest ${requestId} from jobRequest collection.`);
    }, err => {
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
            // Get driver data and shuffle
            let driverArray = Utils.shuffleArray(driverSnap.docs.map(doc => [doc.id, doc.data()]));
            // TODO: Add retry functionality for timed out drivers
            // retryNotifyDrivers(
            //     [requestId, requestData, driverArray],
            //     3,
            // ).then(jobAccepted => {
            //     console.log('Drivers notified');
            //     console.log('Job accepted: ', jobAccepted);
            // }, err => {
            //     console.log(
            //         'Error in retryNotifyDrivers',
            //         JSON.stringify(err));
            // });
            notifyDrivers(requestId, requestData, driverArray)
                .then(jobAccepted => {
                    console.log('Drivers notified');
                    if (!jobAccepted) {
                        // TODO: If no drivers accepted send message to client.
                        console.log('No drivers accepted')
                    }
                    removeJobRequestDatabase(requestId).catch(err => {
                        console.log(err);
                    });
                }, err => {
                    console.log(err);
                });
        }, err => {
            console.log(err);
        });
    });

