// Every Sidequest job class. Worker threads load a bundle of this file, and jobs are resolved by
// class name, so never rename a class while jobs of that name may be queued (alias the old name).
export { SendEmailJob } from '#root/jobs/send-email.job.ts'
