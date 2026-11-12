// The Action Center's Agents tab opens Agent Center (/dashboard/agents), so
// /dashboard/action-center/agents and its subpaths, typed or shared, land on
// the same page there, query kept, as the old Chat › Agents routes do.
export { default } from '../../../chat/agents/[[...path]]/page';
