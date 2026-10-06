import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  public readonly catalogTable: dynamodb.Table;
  public readonly checkoutsTable: dynamodb.Table;
  public readonly bookRequestsTable: dynamodb.Table;
  public readonly historyTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.catalogTable = new dynamodb.Table(this, 'CatalogTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.checkoutsTable = new dynamodb.Table(this, 'CheckoutsTable', {
      partitionKey: { name: 'bookId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // One row per pending "notify me when this is returned" request.
    // requesterUserId as sort key both enforces "one open request per
    // user per book" (conditional put) and lets us query a book's whole
    // queue, ordered by request time via the requestedAt attribute.
    this.bookRequestsTable = new dynamodb.Table(this, 'BookRequestsTable', {
      partitionKey: { name: 'bookId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'requesterUserId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Append-only log of checkout/return/request/hold events per book —
    // distinct from Checkouts (current state only) and BookRequests
    // (pending queue only), so admins can see who held/wanted a book in
    // the past, not just right now. eventAt as sort key gives a natural
    // chronological order per book via a single Query.
    this.historyTable = new dynamodb.Table(this, 'HistoryTable', {
      partitionKey: { name: 'bookId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
