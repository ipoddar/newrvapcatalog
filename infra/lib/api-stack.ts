import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  catalogTable: dynamodb.Table;
  checkoutsTable: dynamodb.Table;
  bookRequestsTable: dynamodb.Table;
  historyTable: dynamodb.Table;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  sesFromAddress: string;
  siteUrl: string;
}

const LAMBDA_DIR = path.join(__dirname, '..', 'lambda');

export class ApiStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { catalogTable, checkoutsTable, bookRequestsTable, historyTable, userPool, userPoolClient, sesFromAddress, siteUrl } = props;

    const commonEnv = {
      CATALOG_TABLE_NAME: catalogTable.tableName,
      CHECKOUTS_TABLE_NAME: checkoutsTable.tableName,
      BOOK_REQUESTS_TABLE_NAME: bookRequestsTable.tableName,
      HISTORY_TABLE_NAME: historyTable.tableName,
      SES_FROM_ADDRESS: sesFromAddress,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      SITE_URL: siteUrl,
    };

    const makeFunction = (name: string, entry: string) =>
      new lambdaNodejs.NodejsFunction(this, name, {
        entry: path.join(LAMBDA_DIR, entry),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: commonEnv,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
      });

    // Hot-path Lambdas — kept warm via a scheduled EventBridge ping (see
    // below), not Provisioned Concurrency, to stay inside the free tier.
    const getCatalogFn = makeFunction('GetCatalogFn', 'getCatalog.ts');
    const checkoutBookFn = makeFunction('CheckoutBookFn', 'checkoutBook.ts');
    const returnBookFn = makeFunction('ReturnBookFn', 'returnBook.ts');

    // Low-frequency admin CRUD Lambdas — not kept warm; the frontend shows
    // a cold-start loading hint for these instead (see
    // utils/fetch-with-cold-start-hint.ts).
    const createItemFn = makeFunction('CreateItemFn', 'createItem.ts');
    const updateItemFn = makeFunction('UpdateItemFn', 'updateItem.ts');
    const deleteItemFn = makeFunction('DeleteItemFn', 'deleteItem.ts');
    const getUsersFn = makeFunction('GetUsersFn', 'getUsers.ts');
    const adminCreateUserFn = makeFunction('AdminCreateUserFn', 'adminCreateUser.ts');
    const adminSetPasswordFn = makeFunction('AdminSetPasswordFn', 'adminSetPassword.ts');
    const requestBookFn = makeFunction('RequestBookFn', 'requestBook.ts');
    const notifyHolderFn = makeFunction('NotifyHolderFn', 'notifyHolder.ts');
    const getBookHistoryFn = makeFunction('GetBookHistoryFn', 'getBookHistory.ts');

    // Not API-routed — invoked only by the daily EventBridge schedule below.
    const sendOverdueRemindersFn = makeFunction(
      'SendOverdueRemindersFn',
      'sendOverdueReminders.ts'
    );
    const expireHoldsFn = makeFunction('ExpireHoldsFn', 'expireHolds.ts');

    catalogTable.grantReadData(getCatalogFn);
    checkoutsTable.grantReadData(getCatalogFn);
    bookRequestsTable.grantReadData(getCatalogFn);

    catalogTable.grantReadWriteData(checkoutBookFn);
    checkoutsTable.grantWriteData(checkoutBookFn);
    historyTable.grantWriteData(checkoutBookFn);
    catalogTable.grantReadWriteData(returnBookFn);
    checkoutsTable.grantReadWriteData(returnBookFn);
    bookRequestsTable.grantReadWriteData(returnBookFn);
    historyTable.grantWriteData(returnBookFn);

    catalogTable.grantReadWriteData(createItemFn);
    catalogTable.grantReadWriteData(updateItemFn);
    catalogTable.grantWriteData(deleteItemFn);
    checkoutsTable.grantWriteData(deleteItemFn);
    bookRequestsTable.grantReadWriteData(deleteItemFn);

    // Checkout/return send confirmation emails and (return) promote the
    // next queued requester (see lib/bookRequests.ts) — both already have
    // Catalog/Checkouts/BookRequests access from the grants above.
    const sesSendPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    });
    checkoutBookFn.addToRolePolicy(sesSendPolicy);
    returnBookFn.addToRolePolicy(sesSendPolicy);

    // Request/notify-holder: a user requesting a book reads Checkouts (is
    // it actually out?) and writes BookRequests; an admin forwarding a
    // nudge reads Checkouts/Catalog and sends via SES.
    checkoutsTable.grantReadData(requestBookFn);
    catalogTable.grantReadData(requestBookFn);
    bookRequestsTable.grantReadWriteData(requestBookFn);
    historyTable.grantWriteData(requestBookFn);
    checkoutsTable.grantReadData(notifyHolderFn);
    catalogTable.grantReadData(notifyHolderFn);
    notifyHolderFn.addToRolePolicy(sesSendPolicy);

    // Admin history view: read-only access to a single book's event log.
    historyTable.grantReadData(getBookHistoryFn);

    // Admin user directory: reads all Cognito users plus every checkout
    // and pending request, joined against the Catalog table for titles.
    checkoutsTable.grantReadData(getUsersFn);
    catalogTable.grantReadData(getUsersFn);
    bookRequestsTable.grantReadData(getUsersFn);
    const listUsersPolicy = new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsers'],
      resources: [userPool.userPoolArn],
    });
    getUsersFn.addToRolePolicy(listUsersPolicy);

    // Checkout-on-behalf-of: resolves the target user's sub to their
    // email/name/phone via a ListUsers filter (see checkoutBook.ts).
    checkoutBookFn.addToRolePolicy(listUsersPolicy);

    // Admin user creation: provisions a Cognito user with an
    // admin-specified permanent password and emails the new user their
    // welcome message + credentials.
    adminCreateUserFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword'],
        resources: [userPool.userPoolArn],
      })
    );
    adminCreateUserFn.addToRolePolicy(sesSendPolicy);

    // Admin password reset: sets an admin-specified permanent password on
    // an existing user and emails them the new credentials.
    adminSetPasswordFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminSetUserPassword', 'cognito-idp:AdminGetUser'],
        resources: [userPool.userPoolArn],
      })
    );
    adminSetPasswordFn.addToRolePolicy(sesSendPolicy);

    // Overdue reminders: reads/writes Checkouts (to stamp lastReminderSentAt),
    // reads Catalog for titles, and sends via SES.
    checkoutsTable.grantReadWriteData(sendOverdueRemindersFn);
    catalogTable.grantReadData(sendOverdueRemindersFn);
    sendOverdueRemindersFn.addToRolePolicy(sesSendPolicy);

    // Check once a day for checkouts crossing the 3-month-since-checkout or
    // 6-month-since-last-reminder threshold (see sendOverdueReminders.ts).
    new events.Rule(this, 'OverdueRemindersScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
      targets: [new targets.LambdaFunction(sendOverdueRemindersFn)],
    });

    // Expired holds: a hold a requester didn't claim within 48h releases
    // and promotes the next person in that book's queue (see
    // expireHolds.ts / lib/bookRequests.ts).
    catalogTable.grantReadWriteData(expireHoldsFn);
    bookRequestsTable.grantReadWriteData(expireHoldsFn);
    historyTable.grantWriteData(expireHoldsFn);
    expireHoldsFn.addToRolePolicy(sesSendPolicy);
    new events.Rule(this, 'ExpireHoldsScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
      targets: [new targets.LambdaFunction(expireHoldsFn)],
    });

    // Warm pool: ping every 5 minutes with a static payload the handler
    // recognizes and returns from immediately, before any auth check or
    // DynamoDB call — cheap (well within Lambda's free tier) and avoids
    // Provisioned Concurrency's hourly charge.
    for (const fn of [getCatalogFn, checkoutBookFn, returnBookFn]) {
      const rule = new events.Rule(this, `${fn.node.id}WarmerRule`, {
        schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      });
      rule.addTarget(
        new targets.LambdaFunction(fn, {
          event: events.RuleTargetInput.fromObject({ warmerPing: true }),
        })
      );
    }

    const authorizer = new authorizers.HttpJwtAuthorizer(
      'JwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] }
    );

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ['Authorization', 'Content-Type'],
      },
    });

    const authorizedRoute = (
      path_: string,
      methods: apigatewayv2.HttpMethod[],
      fn: lambda.IFunction
    ) => {
      httpApi.addRoutes({
        path: path_,
        methods,
        integration: new integrations.HttpLambdaIntegration(
          `${fn.node.id}Integration`,
          fn
        ),
        authorizer,
      });
    };

    // Public browsing: no authorizer attached, so this works for
    // signed-out visitors — getCatalog.ts uses optionalAuth() and
    // personalizes (checkedOutByCurrentUser, etc.) only when a valid JWT
    // happens to be present. Every other route below stays authenticated.
    httpApi.addRoutes({
      path: '/catalog',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        `${getCatalogFn.node.id}Integration`,
        getCatalogFn
      ),
    });
    authorizedRoute('/catalog', [apigatewayv2.HttpMethod.POST], createItemFn);
    authorizedRoute('/catalog/{id}', [apigatewayv2.HttpMethod.PUT], updateItemFn);
    authorizedRoute('/catalog/{id}', [apigatewayv2.HttpMethod.DELETE], deleteItemFn);
    authorizedRoute(
      '/catalog/{id}/checkout',
      [apigatewayv2.HttpMethod.POST],
      checkoutBookFn
    );
    authorizedRoute(
      '/catalog/{id}/return',
      [apigatewayv2.HttpMethod.POST],
      returnBookFn
    );
    authorizedRoute(
      '/catalog/{id}/request',
      [apigatewayv2.HttpMethod.POST],
      requestBookFn
    );
    authorizedRoute(
      '/catalog/{id}/notify-holder',
      [apigatewayv2.HttpMethod.POST],
      notifyHolderFn
    );
    authorizedRoute(
      '/catalog/{id}/history',
      [apigatewayv2.HttpMethod.GET],
      getBookHistoryFn
    );
    authorizedRoute('/admin/users', [apigatewayv2.HttpMethod.GET], getUsersFn);
    authorizedRoute('/admin/users', [apigatewayv2.HttpMethod.POST], adminCreateUserFn);
    authorizedRoute(
      '/admin/users/{email}/password',
      [apigatewayv2.HttpMethod.PUT],
      adminSetPasswordFn
    );

    this.apiUrl = httpApi.apiEndpoint;
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
  }
}
