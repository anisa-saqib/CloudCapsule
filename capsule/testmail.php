<?php
require_once 'api/email/send.php';

$result = sendEmail(
    'anisasaqib05@gmail.com', 
    'Test User', 
    'Test Email from Cloud Capsule', 
    '<h1>Hello!</h1><p>This is a test email.</p>'
);

if ($result['success']) {
    echo "✅ Email sent successfully!";
} else {
    echo "❌ Failed: " . $result['error'];
}
?>