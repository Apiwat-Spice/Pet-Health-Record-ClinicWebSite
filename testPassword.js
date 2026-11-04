const bcrypt = require('bcryptjs');

const password = 'Test1234';
const hash = '$2b$10$3g5582F7p5PngNDGWQ47MutL5YeCQ8aHWNw8KOTHW.hXvKY8fWNYC';

bcrypt.compare(password, hash).then(result => {
  console.log('Password Match:', result);
});