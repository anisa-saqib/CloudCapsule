<?php
header('Content-Type: application/json');
require_once '../../config/database.php';
require_once '../email/send.php';

$data = json_decode(file_get_contents('php://input'), true);
$email = $data['email'] ?? '';

if (!$email) {
    http_response_code(400);
    echo json_encode(['error' => 'Email required']);
    exit;
}

$stmt = $pdo->prepare("SELECT id, username FROM users WHERE email = ?");
$stmt->execute([$email]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$user) {
    echo json_encode(['message' => 'If your email exists, you will receive a reset link']);
    exit;
}

$resetToken = bin2hex(random_bytes(32));
$expires = date('Y-m-d H:i:s', strtotime('+1 hour'));

$stmt = $pdo->prepare("UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?");
$stmt->execute([$resetToken, $expires, $user['id']]);

$resetLink = "https://cloudcapsule.unaux.com/reset-password?token=$resetToken";

$resetHtml = "
<div style='font-family: \"Baloo 2\", cursive; max-width: 500px; margin: 0 auto; padding: 20px; background: linear-gradient(145deg, #ffd9e8, #ffe0f0); border-radius: 30px; border: 3px solid white;'>
    <h1 style='color: #3a1a32; text-align: center;'>☁️ Cloud Capsule</h1>
    <p style='color: #552a45; font-size: 1.1rem;'>Hello {$user['username']},</p>
    <p style='color: #552a45;'>Click the button below to reset your password. This link expires in 1 hour.</p>
    <div style='text-align: center; margin: 30px 0;'>
        <a href='$resetLink' style='background: #b07a9a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; border: 2px solid white; display: inline-block;'>Reset Password</a>
    </div>
    <p style='color: #552a45; font-size: 0.9rem;'>If you didn't request this, please ignore this email.</p>
</div>";

$result = sendEmail($email, $user['username'], '🔐 Reset Your Cloud Capsule Password', $resetHtml);

if ($result['success']) {
    echo json_encode(['message' => 'If your email exists, you will receive a reset link']);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to send email: ' . $result['error']]);
}
?>