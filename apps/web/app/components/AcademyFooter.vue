<template>
  <footer class="academy-footer">
    <div class="academy-footer__main page-container">
      <section class="academy-footer__identity" aria-labelledby="academy-footer-title">
        <img
          src="/images/naem-logo.jpg"
          alt="Logo Học viện Quản lý Giáo dục"
          width="86"
          height="86"
        />
        <div>
          <p>Bộ Giáo dục và Đào tạo</p>
          <h2 id="academy-footer-title">Học viện Quản lý Giáo dục</h2>
          <span>Cổng Dịch vụ Sinh viên</span>
        </div>
      </section>

      <address class="academy-footer__contact">
        <div>
          <strong>Địa chỉ</strong>
          <span>31 Phan Đình Giót, Phương Liệt, Hà Nội</span>
        </div>
        <div>
          <strong>Website</strong>
          <a href="https://www.naem.edu.vn/vi" target="_blank" rel="noopener noreferrer">
            naem.edu.vn
          </a>
        </div>
        <div>
          <strong>Email</strong>
          <a href="mailto:hvqlgd@moet.edu.vn">hvqlgd@moet.edu.vn</a>
        </div>
        <div>
          <strong>Điện thoại</strong>
          <span><a href="tel:02438643352">024.3864.3352</a> · Fax: 024.3864.1802</span>
        </div>
      </address>
    </div>

    <div class="academy-footer__bottom page-container">
      <span>© {{ new Date().getFullYear() }} Học viện Quản lý Giáo dục</span>
      <div>
        <a href="mailto:hvqlgd@moet.edu.vn">Gửi email</a>
        <a href="https://www.naem.edu.vn/vi" target="_blank" rel="noopener noreferrer">
          Trang chủ Học viện <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.academy-footer {
  position: relative;
  overflow: hidden;
  border-top: 3px solid var(--color-accent);
  color: #fff;
  background:
    radial-gradient(circle at 100% 0%, rgb(200 154 66 / 13%), transparent 24rem),
    linear-gradient(135deg, #0d203b, #142f52);
}

.academy-footer::after {
  position: absolute;
  right: -95px;
  bottom: -150px;
  width: 330px;
  height: 330px;
  border: 48px solid rgb(255 255 255 / 2.5%);
  border-radius: 50%;
  content: '';
}

.academy-footer__main {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(420px, 1.1fr);
  gap: 72px;
  padding-top: 46px;
  padding-bottom: 40px;
}

.academy-footer__identity {
  display: flex;
  align-items: center;
  gap: 18px;
}

.academy-footer__identity img {
  width: 86px;
  height: 86px;
  flex: none;
  border: 2px solid rgb(226 189 112 / 72%);
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 16px 34px rgb(0 0 0 / 24%);
}

.academy-footer__identity p {
  margin-bottom: 7px;
  color: #e2bd70;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.academy-footer__identity h2 {
  margin-bottom: 7px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(1.25rem, 2.2vw, 1.65rem);
  line-height: 1.25;
}

.academy-footer__identity span {
  color: rgb(255 255 255 / 56%);
  font-size: 14px;
}

.academy-footer__contact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px 30px;
  margin: 0;
  font-style: normal;
}

.academy-footer__contact div {
  display: grid;
  align-content: start;
  gap: 5px;
}

.academy-footer__contact strong {
  color: #e2bd70;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.academy-footer__contact span,
.academy-footer__contact a {
  color: rgb(255 255 255 / 75%);
  font-size: 14px;
  line-height: 1.55;
  text-decoration: none;
}

.academy-footer__contact a:hover {
  color: #fff;
  text-decoration: underline;
}

.academy-footer__bottom {
  position: relative;
  z-index: 1;
  display: flex;
  min-height: 66px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-top: 1px solid rgb(255 255 255 / 10%);
  color: rgb(255 255 255 / 45%);
  font-size: 12px;
}

.academy-footer__bottom div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.academy-footer__bottom a {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  gap: 5px;
  padding: 7px 11px;
  border: 1px solid rgb(255 255 255 / 13%);
  border-radius: 9px;
  color: rgb(255 255 255 / 72%);
  text-decoration: none;
}
.academy-footer__bottom a:hover {
  border-color: rgb(226 189 112 / 45%);
  color: #fff;
  background: rgb(255 255 255 / 5%);
}

@media (max-width: 820px) {
  .academy-footer__main {
    grid-template-columns: 1fr;
    gap: 34px;
  }
}

@media (max-width: 560px) {
  .academy-footer__main {
    padding-top: 36px;
    padding-bottom: 30px;
  }
  .academy-footer__identity {
    align-items: flex-start;
  }
  .academy-footer__identity img {
    width: 68px;
    height: 68px;
  }
  .academy-footer__contact {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .academy-footer__bottom {
    align-items: flex-start;
    flex-direction: column;
    padding-top: 20px;
    padding-bottom: 22px;
  }
  .academy-footer__bottom div {
    flex-wrap: wrap;
  }
}
</style>
