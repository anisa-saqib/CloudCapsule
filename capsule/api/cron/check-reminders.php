<?php
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../email/send.php';

// Find capsules opening in the next 24 hours
$stmt = $pdo->prepare("
    SELECT c.*, u.email, u.username 
    FROM capsules c
    JOIN users u ON c.user_id = u.id
    WHERE c.open_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)
    AND NOT EXISTS (
        SELECT 1 FROM email_notifications en 
        WHERE en.capsule_id = c.id 
        AND en.type = 'reminder'
    )
");
$stmt->execute();
$capsules = $stmt->fetchAll(PDO::FETCH_ASSOC);

foreach ($capsules as $capsule) {
    $reminderHtml = "
    <div style='font-family: \"Baloo 2\", cursive; max-width: 500px; margin: 0 auto; padding: 20px; background: linear-gradient(145deg, #ffd9e8, #ffe0f0); border-radius: 30px; border: 3px solid white;'>
        <h1 style='color: #3a1a32; text-align: center;'>☁️ Cloud Capsule</h1>
        <h2 style='color: #4a1e3a;'>Hello {$capsule['username']}! ✨</h2>
        <p style='color: #552a45; font-size: 1.1rem;'>Your capsule <strong>\"{$capsule['title']}\"</strong> will open in less than 24 hours!</p>
        <div style='text-align: center; margin: 20px 0;'>
            <div style='background: #b07a9a; color: white; padding: 12px 30px; border-radius: 50px; display: inline-block; font-size: 1.2rem;'>
                " . date('F j, Y \a\t g:i A', strtotime($capsule['open_date'])) . "
            </div>
        </div>
        <div style='text-align: center; margin: 30px 0;'>
            <a href='https://cloudcapsule.unaux.com' style='background: #4a6080; color: white; padding: 12px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; border: 2px solid white; display: inline-block;'>View Your Capsule</a>
        </div>
    </div>";
    
    $result = sendEmail($capsule['email'], $capsule['username'], '⏰ Your Cloud Capsule Opens Soon!', $reminderHtml);
    
    if ($result['success']) {
        $stmt2 = $pdo->prepare("INSERT INTO email_notifications (capsule_id, type, sent_at) VALUES (?, 'reminder', NOW())");
        $stmt2->execute([$capsule['id']]);
    }
}

echo "Reminders checked at " . date('Y-m-d H:i:s');
?>