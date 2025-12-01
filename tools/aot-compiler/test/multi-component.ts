import {Component} from '@angular/core';

@Component({
  selector: 'app-header',
  template: `<header><h1>{{ title }}</h1></header>`,
  styles: ['header { background: #333; color: white; padding: 10px; }'],
  standalone: true,
})
export class HeaderComponent {
  title = 'My App';
}

@Component({
  selector: 'app-footer',
  template: `<footer><p>{{ copyright }}</p></footer>`,
  styles: ['footer { background: #eee; padding: 10px; text-align: center; }'],
  standalone: true,
})
export class FooterComponent {
  copyright = '2024 My Company';
}

@Component({
  selector: 'app-main',
  template: `
    <main>
      <p>Welcome, {{ userName }}!</p>
      @if (isLoggedIn) {
        <button (click)="logout()">Logout</button>
      }
    </main>
  `,
  styles: ['main { padding: 20px; }'],
  standalone: true,
})
export class MainComponent {
  userName = 'Guest';
  isLoggedIn = false;

  logout() {
    this.isLoggedIn = false;
  }
}
