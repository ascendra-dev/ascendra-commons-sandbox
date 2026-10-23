// The sandbox's own Drizzle tables. ascendra-commons' tables are not re-exported here: they come from the migrations
// ascendra-commons.js delivers into ../migrations (drizzle-kit would otherwise generate them a second time).
export { demoUser } from './demo-user';
