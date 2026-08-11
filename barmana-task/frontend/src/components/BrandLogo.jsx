import logoSrc from '../assets/company-logo.jpg';

export default function BrandLogo({ compact = false, subtitle = 'سامانه مدیریت پروژه و عملکرد تیم فنی', light = false }) {
  return (
    <div className={`brand-logo ${compact ? 'is-compact' : ''} ${light ? 'is-light' : ''}`}>
      <img src={logoSrc} alt="لوگوی بارمانا تسک" className="brand-logo-image" />
      <div className="brand-logo-text">
        <strong>بارمانا تسک</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}
