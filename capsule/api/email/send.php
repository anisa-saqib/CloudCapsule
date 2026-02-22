<?php
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../vendor/phpmailer/src/Exception.php';
require_once __DIR__ . '/../vendor/phpmailer/src/PHPMailer.php';
require_once __DIR__ . '/../vendor/phpmailer/src/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

function sendEmail($to, $name, $subject, $htmlContent) {
    $mail = new PHPMailer(true);
    
    try {
        // MAILTRAP SETTINGS — JUST PASTE YOUR CREDENTIALS HERE
        $mail->isSMTP();
        $mail->Host       = 'live.smtp.mailtrap.io';
        $mail->SMTPAuth   = true;
        $mail->Username   = 'api';                          // ← THIS IS ALWAYS "api"
        $mail->Password   = '22e1c72c14e96ec784e3a7b9ee9ccb61';  // ← PASTE THE PASSWORD FROM STEP 2
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = 587;
        
        // Sender and recipient
        $mail->setFrom('noreply@cloudcapsule.unaux.com', 'Cloud Capsule');
        $mail->addAddress($to, $name);
        
        // Content
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $htmlContent;
        
        $mail->send();
        return ['success' => true];
        
    } catch (Exception $e) {
        return ['success' => false, 'error' => $mail->ErrorInfo];
    }
}
?>