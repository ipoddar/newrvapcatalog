#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { CognitoStack } from '../lib/cognito-stack';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';
import { SiteStack } from '../lib/site-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const cognitoStack = new CognitoStack(app, 'RvapCognitoStack', { env });
const dataStack = new DataStack(app, 'RvapDataStack', { env });
const apiStack = new ApiStack(app, 'RvapApiStack', {
  env,
  catalogTable: dataStack.catalogTable,
  checkoutsTable: dataStack.checkoutsTable,
  userPool: cognitoStack.userPool,
  userPoolClient: cognitoStack.userPoolClient,
});
new SiteStack(app, 'RvapSiteStack', { env });

new cdk.CfnOutput(apiStack, 'CognitoUserPoolId', {
  value: cognitoStack.userPool.userPoolId,
});
new cdk.CfnOutput(apiStack, 'CognitoUserPoolClientId', {
  value: cognitoStack.userPoolClient.userPoolClientId,
});
