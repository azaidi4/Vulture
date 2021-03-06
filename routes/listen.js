import express from 'express';
import http from 'http';

import { subscriptionConfiguration } from '../constants';
import { getData } from '../helpers/requestHelper';
import { getSubscription } from '../helpers/dbHelper';
import { itsTimeToVulture } from '../helpers/scraper';

export const listenRouter = express.Router();

/* Default listen route */
listenRouter.post('/', (req, res, next) => {
  let status;
  let clientStatesValid;

  // If there's a validationToken parameter in the query string,
  // then this is the request that Office 365 sends to check
  // that this is a valid endpoint.
  // Just send the validationToken back.
  if (req.query && req.query.validationToken) {
    res.send(req.query.validationToken);
    // Send a status of 'Ok'
    status = 200;
  } else {
    clientStatesValid = false;

    // First, validate all the clientState values in array
    for (let i = 0; i < req.body.value.length; i++) {
      const clientStateValueExpected = subscriptionConfiguration.clientState;

      if (req.body.value[i].clientState !== clientStateValueExpected) {
        // If just one clientState is invalid, we discard the whole batch
        clientStatesValid = false;
        break;
      } else {
        clientStatesValid = true;
      }
    }

    // If all the clientStates are valid, then process the notification
    if (clientStatesValid) {
      for (let i = 0; i < req.body.value.length; i++) {
        const resource = req.body.value[i].resource;
        const subscriptionId = req.body.value[i].subscriptionId;
        processNotification(subscriptionId, resource, res, next);
      }
      // Send a status of 'Accepted'
      status = 202;
    } else {
      // Since the clientState field doesn't have the expected value,
      // this request might NOT come from Microsoft Graph.
      // However, you should still return the same status that you'd
      // return to Microsoft Graph to not alert possible impostors
      // that you have discovered them.
      status = 202;
    }
  }
  res.status(status).end(http.STATUS_CODES[status]);
});

// Get subscription data from the database
// Retrieve the actual mail message data from Office 365.
// Send the message data to be vultured
function processNotification(subscriptionId, resource, res, next) {
  getSubscription(subscriptionId, (dbError, subscriptionData) => {
    if (subscriptionData) {
      getData(
        `/v1.0/${resource}`,
        subscriptionData.accessToken,
        (requestError, endpointData) => {
          if (endpointData) {
            const hours = findHours(endpointData);
            if (hours) {
              itsTimeToVulture(hours)
                .then(() => console.log('picked up'))
                .catch(error => console.log(error));
            }
          } else if (requestError) {
            res.status(500);
            next(requestError);
          }
        }
      );
    } else if (dbError) {
      res.status(500);
      next(dbError);
    }
  });
}

const findHours = (mailData) => {
  let hours;
  let sender = mailData.from.emailAddress.address;
  let subject = mailData.subject.split(' ');
  let dropee = `${subject[3]} ${subject[4]}`;

  if (sender === 'consults@cae.wisc.edu' && dropee !== 'Ahmad Zaidi') {
    let body = mailData.body.content;
    let lines = body.split('\n');
    hours = [];

    lines.forEach((line) => {
      if (line.includes('AVAILABLE')) {
        let tokenizedLine = line.split(' ');
        hours.push({
          date: tokenizedLine[tokenizedLine.length - 1],
          from: (tokenizedLine[0] + tokenizedLine[1]),
          to: (tokenizedLine[3] + tokenizedLine[4])
        });
      }
    });
  } else {
    if (sender !== 'consults@cae.wisc.edu') {
      console.error(`Sender should be consults@cae.wisc.edu, not ${sender}`);
    }
    if (dropee === 'Ahmad Zaidi') {
      console.error(`If I picked your own shifts it would ruin the point, ${dropee}`);
    }
  }
  return hours;
};
