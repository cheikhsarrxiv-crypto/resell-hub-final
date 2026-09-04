import { NotificationService } from './NotificationService';

/**
 * Email provider types
 */
export type EmailProvider = 'sendgrid' | 'mailgun' | 'resend' | 'none';

/**
 * Email content structure
 */
export interface EmailContent {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, any>;
}

/**
 * Email send result
 */
export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Abstract Email Service
 * Supports multiple providers: SendGrid, Mailgun, Resend
 */
export class EmailService {
  private static provider: EmailProvider = (
    process.env.EMAIL_PROVIDER?.trim().toLowerCase() || 'none'
  ) as EmailProvider;
  private static fromEmail =
    process.env.EMAIL_FROM || 'noreply@adksy.local';
  private static fromName = process.env.EMAIL_FROM_NAME || 'ADKSY';

  /**
   * Initialize email service based on provider
   */
  static initialize() {
    if (this.provider === 'none') {
      console.warn(
        '[EmailService] Email provider not configured. Set EMAIL_PROVIDER env var.'
      );
      return;
    }

    console.log(`[EmailService] Initialized with provider: ${this.provider}`);

    // Validate required keys based on provider
    switch (this.provider) {
      case 'sendgrid':
        if (!process.env.SENDGRID_API_KEY) {
          throw new Error('SENDGRID_API_KEY not configured');
        }
        break;
      case 'mailgun':
        if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
          throw new Error('MAILGUN_API_KEY or MAILGUN_DOMAIN not configured');
        }
        break;
      case 'resend':
        if (!process.env.RESEND_API_KEY) {
          throw new Error('RESEND_API_KEY not configured');
        }
        break;
    }
  }

  /**
   * Send email verification link
   */
  static async sendVerificationEmail(
    email: string,
    verificationUrl: string
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: 'Verify your ADKSY email address',
      template: 'verification',
      variables: {
        verificationUrl,
      },
    });
  }

  /**
   * Send welcome email
   */
  static async sendWelcomeEmail(
    email: string,
    userName: string
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: 'Welcome to ADKSY',
      template: 'welcome',
      variables: {
        userName,
        appUrl: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      },
    });
  }

  /**
   * Send new order notification
   */
  static async sendNewOrderNotification(
    email: string,
    orderId: string,
    productTitle: string,
    price: number
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: `New Order: ${productTitle}`,
      template: 'new-order',
      variables: {
        orderId,
        productTitle,
        price,
        dashboardUrl: `${process.env.NEXTAUTH_URL}/orders/${orderId}`,
      },
    });
  }

  /**
   * Send order accepted notification
   */
  static async sendOrderAcceptedNotification(
    email: string,
    orderId: string,
    productTitle: string
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: `Order Accepted: ${productTitle}`,
      template: 'order-accepted',
      variables: {
        orderId,
        productTitle,
        dashboardUrl: `${process.env.NEXTAUTH_URL}/orders/${orderId}`,
      },
    });
  }

  /**
   * Send order preparing notification
   */
  static async sendOrderPreparingNotification(
    email: string,
    orderId: string,
    productTitle: string
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: `Order Preparing: ${productTitle}`,
      template: 'order-preparing',
      variables: {
        orderId,
        productTitle,
        dashboardUrl: `${process.env.NEXTAUTH_URL}/orders/${orderId}`,
      },
    });
  }

  /**
   * Send order shipped notification
   */
  static async sendOrderShippedNotification(
    email: string,
    orderId: string,
    productTitle: string,
    trackingNumber?: string
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: `Order Shipped: ${productTitle}`,
      template: 'order-shipped',
      variables: {
        orderId,
        productTitle,
        trackingNumber,
        dashboardUrl: `${process.env.NEXTAUTH_URL}/orders/${orderId}`,
      },
    });
  }

  /**
   * Send tracking available notification
   */
  static async sendTrackingAvailableNotification(
    email: string,
    orderId: string,
    trackingNumber: string,
    trackingUrl?: string
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: `Track Your Package: ${trackingNumber}`,
      template: 'tracking-available',
      variables: {
        orderId,
        trackingNumber,
        trackingUrl,
        dashboardUrl: `${process.env.NEXTAUTH_URL}/orders/${orderId}`,
      },
    });
  }

  /**
   * Send fulfillment error notification
   */
  static async sendFulfillmentErrorNotification(
    email: string,
    orderId: string,
    errorMessage: string
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: `Order Error: ${orderId}`,
      template: 'fulfillment-error',
      variables: {
        orderId,
        errorMessage,
        dashboardUrl: `${process.env.NEXTAUTH_URL}/orders/${orderId}`,
      },
    });
  }

  /**
   * Send payment failed notification
   */
  static async sendPaymentFailedNotification(
    email: string,
    amount: number,
    orderId?: string
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: 'Payment Failed - Action Required',
      template: 'payment-failed',
      variables: {
        amount,
        orderId,
        billingUrl: `${process.env.NEXTAUTH_URL}/subscription`,
      },
    });
  }

  /**
   * Send subscription created notification
   */
  static async sendSubscriptionCreatedNotification(
    email: string,
    planName: string,
    price: number
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: `Welcome to ${planName} Plan`,
      template: 'subscription-created',
      variables: {
        planName,
        price,
        subscriptionUrl: `${process.env.NEXTAUTH_URL}/subscription`,
      },
    });
  }

  /**
   * Send subscription canceled notification
   */
  static async sendSubscriptionCanceledNotification(
    email: string,
    planName: string
  ): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: `Subscription Canceled: ${planName}`,
      template: 'subscription-canceled',
      variables: {
        planName,
        downgradedTo: 'Free',
        subscriptionUrl: `${process.env.NEXTAUTH_URL}/subscription`,
      },
    });
  }

  /**
   * Core send method - routes to provider
   */
  private static async send(content: EmailContent): Promise<EmailResult> {
    // Log to notification service (always)
    try {
      await NotificationService.logNotification('email', content.to, {
        subject: content.subject,
        template: content.template,
      });
    } catch (err) {
      console.error('[EmailService] Failed to log notification:', err);
    }

    // If no provider configured, return success but with message
    if (this.provider === 'none') {
      console.log(
        `[EmailService] EMAIL_PROVIDER_NOT_CONFIGURED - Would send: ${content.subject} to ${content.to}`
      );
      return {
        success: true,
        messageId: 'mock-' + Date.now(),
      };
    }

    // Route to provider
    switch (this.provider) {
      case 'sendgrid':
        return this.sendViaSendGrid(content);
      case 'mailgun':
        return this.sendViaMailgun(content);
      case 'resend':
        return this.sendViaResend(content);
      default:
        return {
          success: false,
          error: `Unknown provider: ${this.provider}`,
        };
    }
  }

  /**
   * Send via SendGrid
   */
  private static async sendViaSendGrid(
    content: EmailContent
  ): Promise<EmailResult> {
    try {
      // Dynamic import to avoid requiring sendgrid if not used
      const sgMail = await import('@sendgrid/mail');
      sgMail.default.setApiKey(process.env.SENDGRID_API_KEY!);

      const msg = {
        to: content.to,
        from: `${this.fromName} <${this.fromEmail}>`,
        subject: content.subject,
        html: this.renderEmailTemplate(content.template, content.variables),
      };

      const [response] = await sgMail.default.send(msg);
      console.log(`[EmailService] SendGrid sent to ${content.to}`);
      return {
        success: true,
        messageId: response.headers['x-message-id'],
      };
    } catch (error) {
      console.error('[EmailService] SendGrid error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'SendGrid error',
      };
    }
  }

  /**
   * Send via Mailgun
   */
  private static async sendViaMailgun(
    content: EmailContent
  ): Promise<EmailResult> {
    try {
      // Dynamic import
      const Mailgun = (await import('mailgun.js')).default;
      const mailgun = new Mailgun(FormData as any);
      const mg = mailgun.client({
        username: 'api',
        key: process.env.MAILGUN_API_KEY!,
      });

      const msg = {
        from: `${this.fromName} <${this.fromEmail}>`,
        to: content.to,
        subject: content.subject,
        html: this.renderEmailTemplate(content.template, content.variables),
      };

      const result = await mg
        .messages.create(process.env.MAILGUN_DOMAIN!, msg);
      console.log(`[EmailService] Mailgun sent to ${content.to}`);
      return {
        success: true,
        messageId: result.id,
      };
    } catch (error) {
      console.error('[EmailService] Mailgun error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Mailgun error',
      };
    }
  }

  /**
   * Send via Resend
   */
  private static isResendErrorResponse(error: unknown): error is {
    message: string;
    statusCode: number | null;
    name: string;
  } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      'name' in error &&
      typeof (error as { message: unknown }).message === 'string' &&
      typeof (error as { name: unknown }).name === 'string'
    );
  }

  private static async sendViaResend(
    content: EmailContent
  ): Promise<EmailResult> {
    try {
      // Dynamic import
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY!);

      const result = await resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: content.to,
        subject: content.subject,
        html: this.renderEmailTemplate(content.template, content.variables),
      });

      if (result.error) {
        throw result.error;
      }

      console.log(`[EmailService] Resend sent to ${content.to}`);
      return {
        success: true,
        messageId: result.data?.id,
      };
    } catch (error) {
      // Resend's SDK throws its ErrorResponse shape (message/statusCode/name)
      // as a plain object, not an Error instance — `error instanceof Error`
      // is false for it, so the real detail was previously discarded in
      // favor of a generic 'Resend error' string. Log/return only these
      // three fields explicitly (never the raw error object, which could
      // in principle carry more than intended) — no key or other secret
      // is ever part of this shape.
      if (this.isResendErrorResponse(error)) {
        console.error('[EmailService] Resend error:', {
          message: error.message,
          statusCode: error.statusCode,
          name: error.name,
        });
        return {
          success: false,
          error: error.message,
        };
      }

      console.error(
        '[EmailService] Resend error:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Resend error',
      };
    }
  }

  /**
   * Render email template with variables
   */
  private static renderEmailTemplate(
    template: string,
    variables: Record<string, any>
  ): string {
    // Simple template rendering - replace {{variable}} with value
    let html = this.getEmailTemplate(template);

    Object.entries(variables).forEach(([key, value]) => {
      html = html.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    });

    return html;
  }

  /**
   * Get email template HTML
   */
  private static getEmailTemplate(template: string): string {
    const templates: Record<string, string> = {
      verification: `
<h1>Verify your email address</h1>
<p>Thanks for signing up for ADKSY. Please confirm your email address to activate your account.</p>
<p><a href="{{verificationUrl}}">Verify my email</a></p>
<p>This link expires in 24 hours. If you didn't create an ADKSY account, you can ignore this email.</p>
      `,
      welcome: `
<h1>Welcome to ADKSY</h1>
<p>Hi {{userName}},</p>
<p>Welcome to ADKSY! You're now ready to start selling across multiple marketplaces.</p>
<p><a href="{{appUrl}}">Get Started</a></p>
      `,
      'new-order': `
<h1>New Order Received</h1>
<p>Order ID: {{orderId}}</p>
<p>Product: {{productTitle}}</p>
<p>Price: €{{price}}</p>
<p><a href="{{dashboardUrl}}">View Order</a></p>
      `,
      'order-accepted': `
<h1>Order Accepted</h1>
<p>Your order {{orderId}} for {{productTitle}} has been accepted by fulfillment.</p>
<p><a href="{{dashboardUrl}}">Track Order</a></p>
      `,
      'order-preparing': `
<h1>Order Preparing</h1>
<p>Your order {{orderId}} is being prepared for shipment.</p>
<p><a href="{{dashboardUrl}}">Track Order</a></p>
      `,
      'order-shipped': `
<h1>Order Shipped</h1>
<p>Your order {{orderId}} has been shipped.</p>
{{#trackingNumber}}<p>Tracking: {{trackingNumber}}</p>{{/trackingNumber}}
<p><a href="{{dashboardUrl}}">Track Shipment</a></p>
      `,
      'tracking-available': `
<h1>Tracking Available</h1>
<p>Tracking number: {{trackingNumber}}</p>
{{#trackingUrl}}<p><a href="{{trackingUrl}}">Track Package</a></p>{{/trackingUrl}}
<p><a href="{{dashboardUrl}}">View Order</a></p>
      `,
      'fulfillment-error': `
<h1>Order Error</h1>
<p>Order {{orderId}} encountered an error:</p>
<p>{{errorMessage}}</p>
<p><a href="{{dashboardUrl}}">View Details</a></p>
      `,
      'payment-failed': `
<h1>Payment Failed</h1>
<p>Your payment of €{{amount}} failed.</p>
{{#orderId}}<p>Order ID: {{orderId}}</p>{{/orderId}}
<p><a href="{{billingUrl}}">Update Payment Method</a></p>
      `,
      'subscription-created': `
<h1>Welcome to {{planName}}</h1>
<p>Your subscription to {{planName}} (€{{price}}/month) is now active.</p>
<p><a href="{{subscriptionUrl}}">Manage Subscription</a></p>
      `,
      'subscription-canceled': `
<h1>Subscription Canceled</h1>
<p>Your {{planName}} subscription has been canceled.</p>
<p>You've been downgraded to {{downgradedTo}} plan.</p>
<p><a href="{{subscriptionUrl}}">Manage Subscription</a></p>
      `,
    };

    return (
      templates[template] ||
      `<p>Email template not found: {{template}}</p>`
    );
  }
}

// Initialize on module load
EmailService.initialize();
