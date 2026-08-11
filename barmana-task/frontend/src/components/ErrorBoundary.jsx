import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fatal-error">
          <div><strong>نمایش صفحه با خطا مواجه شد.</strong><p>صفحه را دوباره بارگذاری کنید. اگر خطا ادامه داشت، Log مرورگر و Backend را بررسی کنید.</p><button className="button button-primary" onClick={() => window.location.reload()}>بارگذاری دوباره</button></div>
        </div>
      );
    }
    return this.props.children;
  }
}
