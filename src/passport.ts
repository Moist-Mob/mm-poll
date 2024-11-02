// import passport from 'passport';
// import {Strategy as TwitchStrategy} from 'passport-twitch-new';
// import express, { type Express } from 'express';

// import { PDeps } from "./deps";

// export const initPassport = async ({config, secrets}: PDeps<'config'|'secrets'>) => {
//   const {twitch} = await secrets.load();
//   const router = express.Router();

//   passport.use(
//       new TwitchStrategy(
//           {
//               clientID: twitch.app.clientId,
//               clientSecret: twitch.app.clientSecret.unwrap(),
//               callbackURL: 'callback',
//               scope: 'user_read',
//               customHeaders: {
//                   'client-id': twitch.app.clientId,
//               },
//           },
//           function (accessToken: string, refreshToken: string, profile: any, done: ) {
//               debug(`Updating database with user ${profile.id}: ${profile.login}`);
//               Bluebird.resolve(db.upsert(profile, accessToken, refreshToken)).asCallback(done);
//           }
//       )
//   );

//   passport.serializeUser(function (user, done) {
//       done(null, user.id);
//   });

//   passport.deserializeUser(function (userId, done) {
//       db.getUserById(userId)
//           .then((user) => {
//               if (user === undefined) {
//                   throw new Error('User not found');
//               }
//               done(null, user);
//           })
//           .catch((err) => done(err));
//   });

//   router.use(passport);

//   return {router, passport};
// };
